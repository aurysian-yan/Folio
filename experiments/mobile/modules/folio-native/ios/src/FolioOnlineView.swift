// 在线网页仅使用 WebKit，不注册应用脚本桥接。
import ExpoModulesCore
import FolioFileServices
import WebKit

final class FolioOnlineView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onBrowserState = EventDispatcher()
  let onDownloadIntent = EventDispatcher()
  private let web: WKWebView
  private var commandID = ""
  private var provider: [String: Any] = [:]
  private var sourcePage = ""

  required init(appContext: AppContext? = nil) {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    web = WKWebView(frame: .zero, configuration: configuration)
    super.init(appContext: appContext)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.isInspectable = false
    addSubview(web)
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    web.frame = bounds
  }
  deinit {
    web.stopLoading()
    web.navigationDelegate = nil
    web.uiDelegate = nil
  }

  func setActive(_ active: Bool) {
    web.isHidden = !active
    web.isUserInteractionEnabled = active
  }
  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) { decisionHandler(.deny) }

  func setProvider(_ value: String) {
    provider = (try? JSONSerialization.jsonObject(with: Data(value.utf8))) as? [String: Any] ?? [:]
  }
  func command(_ value: String) {
    guard
      let request = (try? JSONSerialization.jsonObject(with: Data(value.utf8))) as? [String: Any],
      let id = request["id"] as? String, id != commandID
    else { return }
    commandID = id
    switch request["action"] as? String {
    case "navigate":
      do {
        guard let value = request["url"] as? String else { throw FolioPaths.failure() }
        let url = try FolioFileRuntime.shared().browser.validateAddress(url: value)
        sourcePage = ""
        web.load(URLRequest(url: URL(string: url)!))
      } catch { emit(error: "online.browser.invalidSource") }
    case "back": web.goBack()
    case "forward": web.goForward()
    case "reload": web.reload()
    case "stop": web.stopLoading()
    case "clear":
      web.stopLoading()
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
      ) {}
      HTTPCookieStorage.shared.removeCookies(since: .distantPast)
      web.loadHTMLString("", baseURL: nil)
    default: break
    }
  }
  private func emit(error: String? = nil) {
    onBrowserState([
      "url": web.url?.absoluteString ?? "", "title": web.title ?? "", "loading": web.isLoading,
      "canGoBack": web.canGoBack, "canGoForward": web.canGoForward,
      "errorKey": error as Any? ?? NSNull(),
    ])
  }
  private func allowed(_ url: URL) -> Bool {
    if url.absoluteString == "about:blank" { return true }
    if url.scheme == "https" {
      return (try? FolioFileRuntime.shared().browser.validateAddress(url: url.absoluteString))
        != nil
    }
    if ["baiduyun", "bdpan", "aliyundrive", "alipan", "quark"].contains(url.scheme ?? "") {
      UIApplication.shared.open(url, options: [:]) { [weak self] success in
        if !success { self?.emit(error: "online.browser.clientMissing") }
      }
    } else {
      emit(error: "online.browser.unsupportedLink")
    }
    return false
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    if !allowed(url) {
      decisionHandler(.cancel)
      return
    }
    if action.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    if action.targetFrame == nil {
      web.load(action.request)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let disposition =
      (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
      ?? ""
    if response.isForMainFrame
      && (!response.canShowMIMEType || disposition.lowercased().contains("attachment"))
    {
      guard let url = response.response.url, url.scheme == "https" else {
        decisionHandler(.cancel)
        emit(error: "online.browser.unsupportedLink")
        return
      }
      offer(url: url, name: response.response.suggestedFilename ?? "download")
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }
  func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) {
    download.cancel { _ in }
    guard let url = navigationAction.request.url, url.scheme == "https" else {
      emit(error: "online.browser.unsupportedLink")
      return
    }
    offer(url: url, name: url.lastPathComponent)
  }
  private func offer(url: URL, name: String) {
    let page = sourcePage.isEmpty ? (web.url?.absoluteString ?? url.absoluteString) : sourcePage
    let origin: [String: Any] = [
      "providerId": provider["id"] as Any? ?? NSNull(),
      "providerName": provider["name"] as? String ?? "", "sourcePageUrl": page,
      "downloadHost": url.host ?? "",
    ]
    web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
      guard let self else { return }
      let matching = cookies.filter { cookie in
        let domain =
          cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
        return url.host == domain || (url.host?.hasSuffix("." + domain) ?? false)
      }
      matching.forEach { HTTPCookieStorage.shared.setCookie($0) }
      let request = URLRequest(url: url)
      let id = FolioOnlineTransfers.shared.intent(request: request, name: name, origin: origin)
      self.onDownloadIntent(["id": id, "name": name])
    }
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    emit()
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = web.url, let home = provider["homepage"] as? String,
      let host = URL(string: home)?.host,
      url.host == host || (url.host?.hasSuffix("." + host) ?? false)
    {
      sourcePage = url.absoluteString
      if let providerID = provider["id"] as? String {
        web.evaluateJavaScript(FolioOnlineIcons.discoveryScript, in: nil, in: .defaultClient) {
          result in
          let candidates = (try? result.get()) as? [String] ?? []
          FolioOnlineIcons.capture(
            providerID: providerID, pageURL: url.absoluteString, candidates: candidates)
        }
      }
    }
    emit()
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if (error as NSError).code != NSURLErrorCancelled { emit(error: "online.browser.loadError") }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled { emit(error: "online.browser.loadError") }
  }
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url, allowed(url) { web.load(action.request) }
    return nil
  }
}

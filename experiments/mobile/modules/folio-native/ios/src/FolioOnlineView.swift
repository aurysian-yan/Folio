// 在线网页仅使用 WebKit，不注册应用脚本桥接。
import ExpoModulesCore
import FolioFileServices
import WebKit

final class FolioOnlineView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onBrowserState = EventDispatcher()
  let onDownloadIntent = EventDispatcher()
  private let web: WKWebView
  private let refreshControl = UIRefreshControl()
  private var commandID = ""
  private var provider: [String: Any] = [:]
  private var sourcePage = ""
  private var webTheme = ""
  private var pendingTheme: String?
  private var lastState = ""
  private var lastThemeURL = ""
  private var isActive = false
  private var pollTimer: Timer?
  private var pageLoaded = false
  private var pageFailed = false
  private var contentReady = false
  private var loading = true
  private var themeRevision = 0
  private var currentNavigation: WKNavigation?
  private var loadError: String?

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
    web.isHidden = true
    refreshControl.addTarget(self, action: #selector(refreshPage), for: .valueChanged)
    web.scrollView.refreshControl = refreshControl
    addSubview(web)
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    web.frame = bounds
  }
  deinit {
    pollTimer?.invalidate()
    web.stopLoading()
    web.navigationDelegate = nil
    web.uiDelegate = nil
  }

  func setActive(_ active: Bool) {
    isActive = active
    updateVisibility()
    if active { startPolling() } else { stopPolling() }
  }
  func setWebTheme(_ value: String) {
    guard value != webTheme else { return }
    webTheme = value
    applyWebTheme()
  }
  func setAccentColor(_ value: String) {
    refreshControl.tintColor = Self.color(from: value)
  }
  @objc private func refreshPage() { beginLoading(); web.reload() }
  private func startPolling() {
    guard pollTimer == nil else { return }
    pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      guard let self, self.isActive else { return }
      let url = self.web.url?.absoluteString ?? ""
      if url != self.lastThemeURL {
        self.lastThemeURL = url
        self.applyWebTheme()
      }
      self.emit()
    }
  }
  private func stopPolling() {
    pollTimer?.invalidate()
    pollTimer = nil
  }
  private func applyWebTheme() {
    guard pageLoaded, !pageFailed, !webTheme.isEmpty, web.url != nil else { return }
    let script = webTheme
    if pendingTheme == script { return }
    themeRevision += 1
    let revision = themeRevision
    pendingTheme = script
    loadError = nil
    // 同一文档的地址和主题更新不重置已经就绪的页面。
    if !contentReady {
      loading = true
      updateVisibility()
      emit()
    }
    web.evaluateJavaScript(script, in: nil, in: .defaultClient) { [weak self] result in
      guard let self, self.themeRevision == revision,
        self.pageLoaded, !self.pageFailed else { return }
      guard case .success(let value) = result, value as? Bool == true else {
        self.failLoading()
        return
      }
      self.pendingTheme = nil
      self.contentReady = true
      self.loading = false
      self.refreshControl.endRefreshing()
      self.updateVisibility()
      self.emit()
    }
  }
  private func beginLoading() {
    themeRevision += 1
    pendingTheme = nil
    currentNavigation = nil
    loadError = nil
    pageLoaded = false
    pageFailed = false
    contentReady = false
    loading = true
    updateVisibility()
    emit(force: true)
  }
  private func failLoading(error: String? = "online.browser.loadError") {
    themeRevision += 1
    pendingTheme = nil
    loadError = error
    contentReady = false
    loading = false
    refreshControl.endRefreshing()
    updateVisibility()
    emit()
  }
  private func updateVisibility() {
    web.isHidden = !isActive || !contentReady
    web.isUserInteractionEnabled = isActive && contentReady
  }
  private static func color(from value: String) -> UIColor? {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.hasPrefix("#"), text.count == 7 || text.count == 9 else { return nil }
    let hex = String(text.dropFirst())
    guard let number = UInt64(hex, radix: 16) else { return nil }
    if hex.count == 6 {
      return UIColor(red: CGFloat((number >> 16) & 0xff) / 255,
                     green: CGFloat((number >> 8) & 0xff) / 255,
                     blue: CGFloat(number & 0xff) / 255, alpha: 1)
    }
    return UIColor(red: CGFloat((number >> 24) & 0xff) / 255,
                   green: CGFloat((number >> 16) & 0xff) / 255,
                   blue: CGFloat((number >> 8) & 0xff) / 255,
                   alpha: CGFloat(number & 0xff) / 255)
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
        beginLoading()
        web.load(URLRequest(url: URL(string: url)!))
      } catch {
        if !contentReady { loading = false }
        emit(error: "online.browser.invalidSource")
      }
    case "back": if web.canGoBack { beginLoading(); web.goBack() }
    case "forward": if web.canGoForward { beginLoading(); web.goForward() }
    case "reload": refreshPage()
    case "stop":
      web.stopLoading()
      currentNavigation = nil
      pageFailed = true
      failLoading(error: nil)
    case "clear":
      web.stopLoading()
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast
      ) {}
      HTTPCookieStorage.shared.removeCookies(since: .distantPast)
      beginLoading()
      web.loadHTMLString("", baseURL: nil)
    default: break
    }
  }
  private func emit(error: String? = nil, force: Bool = false) {
    let url = web.url?.absoluteString ?? ""
    let title = web.title ?? ""
    let errorKey = error ?? loadError
    let signature = "\(url)|\(title)|\(loading)|\(web.canGoBack)|\(web.canGoForward)|\(errorKey ?? "")"
    if !force && error == nil && signature == lastState { return }
    lastState = signature
    onBrowserState([
      "url": url, "title": title, "loading": loading,
      "canGoBack": web.canGoBack, "canGoForward": web.canGoForward,
      "errorKey": errorKey as Any? ?? NSNull(),
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
      resumeAfterDownload()
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
    resumeAfterDownload()
  }
  private func resumeAfterDownload() {
    guard !contentReady else { return }
    pageLoaded = true
    lastThemeURL = web.url?.absoluteString ?? ""
    applyWebTheme()
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
    beginLoading()
    currentNavigation = navigation
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard navigation === currentNavigation, !pageFailed else { return }
    pageLoaded = true
    lastThemeURL = web.url?.absoluteString ?? ""
    applyWebTheme()
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
    navigationFailed(navigation, error: error)
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    navigationFailed(navigation, error: error)
  }
  private func navigationFailed(_ navigation: WKNavigation?, error: Error) {
    guard navigation === currentNavigation else { return }
    if (error as NSError).code == NSURLErrorCancelled {
      if !web.isLoading {
        pageLoaded = true
        applyWebTheme()
      }
      return
    }
    pageFailed = true
    failLoading()
  }
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url, allowed(url) { web.load(action.request) }
    return nil
  }
}

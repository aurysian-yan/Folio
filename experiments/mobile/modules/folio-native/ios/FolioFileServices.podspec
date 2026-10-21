Pod::Spec.new do |s|
  s.name = 'FolioFileServices'
  s.version = '0.1.0'
  s.summary = 'Folio 原生文件服务与扩展边界'
  s.author = 'Folio'
  s.homepage = 'https://github.com/aurysian-yan/Folio'
  s.license = { :type => 'AGPL-3.0-only' }
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'files/**/*.swift', 'src/FolioSyncCredentials.swift', 'generated/*.swift'
  s.vendored_frameworks = 'Frameworks/FolioFFI.xcframework'
  s.resource_bundles = { 'FolioFileStrings' => ['generated/locales/*.json'] }
  s.pod_target_xcconfig = { 'APPLICATION_EXTENSION_API_ONLY' => 'YES' }
  s.frameworks = 'CoreText', 'Security', 'SystemConfiguration'
  s.libraries = 'c++', 'resolv'
end

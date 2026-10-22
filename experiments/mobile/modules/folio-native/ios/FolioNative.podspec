Pod::Spec.new do |s|
  s.name = 'FolioNative'
  s.version = '0.1.0'
  s.summary = 'Folio 移动端 Rust 与原生字体边界'
  s.description = s.summary
  s.author = 'Folio'
  s.homepage = 'https://github.com/aurysian-yan/Folio'
  s.license = { :type => 'AGPL-3.0-only' }
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'FolioFileServices'
  s.dependency 'ZIPFoundation', '0.9.20'
  s.source_files = 'src/**/*.swift'
  s.exclude_files = 'src/FolioSyncCredentials.swift'
  s.frameworks = 'CoreText', 'Security', 'SystemConfiguration', 'WebKit'
  s.libraries = 'c++', 'resolv'
end

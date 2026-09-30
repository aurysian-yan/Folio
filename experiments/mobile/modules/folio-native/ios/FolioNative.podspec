Pod::Spec.new do |s|
  s.name = 'FolioNative'
  s.version = '0.1.0'
  s.summary = 'Folio 移动端 Rust 与原生字体边界'
  s.description = s.summary
  s.author = 'Folio'
  s.homepage = 'https://github.com/aurysian-yan/Folio'
  s.license = { :type => 'AGPL-3.0-only', :file => '../../../../../LICENSE' }
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'src/**/*.swift', 'generated/*.swift'
  s.vendored_frameworks = 'Frameworks/FolioFFI.xcframework'
  s.frameworks = 'CoreText', 'Security', 'SystemConfiguration'
  s.libraries = 'c++', 'resolv'
end

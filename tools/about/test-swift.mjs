import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const source = readFileSync('apps/macos/Folio/Views/AboutView.swift','utf8');
const code = source.slice(source.indexOf('private struct AboutRelease:'), source.indexOf('\nstruct AboutView:'));
const directory = mkdtempSync(join(tmpdir(),'folio-about-swift-'));
try {
  const path = join(directory,'main.swift');
  writeFileSync(path,`import Foundation\n${code}\n
assert((try? AboutRelease.compare("1.10.0", "1.9.0")) == .orderedDescending)
assert((try? AboutRelease.compare("1.0.0-rc.10", "1.0.0-rc.2")) == .orderedDescending)
assert((try? AboutRelease.compare("1.0.0", "1.0.0-rc.2")) == .orderedDescending)
assert((try? AboutRelease.compare("1.0.0+2", "1.0.0+3")) == .orderedSame)
assert(AboutRelease.publishedDate("2026-10-08T12:00:00.000Z") != nil)
assert(AboutRelease.publishedDate("2026-10-08T12:00:00Z") != nil)
assert(AboutRelease.publishedDate("2026-02-31T12:00:00Z") == nil)
assert(!AboutRelease.validURL("https://github.com.evil.test/aurysian-yan/Folio/releases/tag/v1.0.0"))
assert(!AboutRelease.validURL("https://github.com/aurysian-yan/Folio/releases/tag/v1.0.0?next=evil"))
let json = #"{"schemaVersion":1,"version":"1.1.0","publishedAt":"2026-10-08T12:00:00.000Z","releaseUrl":"https://github.com/aurysian-yan/Folio/releases/tag/v1.1.0","artifacts":[{"platform":"macos","arch":"arm64","format":"dmg","size":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"https://github.com/aurysian-yan/Folio/releases/download/v1.1.0/Folio.dmg"}]}"#
private let manifest = try JSONDecoder().decode(AboutRelease.self,from:Data(json.utf8))
try manifest.validate(expected:"1.1.0")
do { try manifest.validate(expected:"1.2.0"); fatalError("必须拒绝不一致版本") } catch {}
do { _ = try AboutRelease.compare("01.0.0", "1.0.0"); fatalError("必须拒绝无效版本") } catch {}
print("macOS 更新协议验证通过")
`);
  const binary = join(directory,'test'); execFileSync('swiftc',[path,'-o',binary],{stdio:'inherit'}); execFileSync(binary,[],{stdio:'inherit'});
} finally { rmSync(directory,{recursive:true,force:true}); }

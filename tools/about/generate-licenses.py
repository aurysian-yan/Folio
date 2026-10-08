#!/usr/bin/env python3
# 收集锁定依赖的原始许可、版权与声明，生成离线阅读目录。
import hashlib,json,os,pathlib,re,subprocess,plistlib,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'shared/about/licenses.json'
entries={}; texts={}
def put(name,version,license,source,platforms,documents):
    key=(name,version,source)
    ids=[]
    for title,body in documents:
        if not body.strip(): continue
        ident=hashlib.sha256(body.encode()).hexdigest()
        texts[ident]=body
        ids.append({'title':title,'text':ident})
    if key in entries:
        entries[key]['platforms']=sorted(set(entries[key]['platforms']+platforms)); return
    entries[key]={'id':hashlib.sha256('|'.join(key).encode()).hexdigest()[:16],'name':name,'version':version,'license':license or 'See notices','source':source,'platforms':platforms,'documents':ids,'declarationOnly':not bool(ids)}
def documents(directory):
    results=[]
    for base,dirs,files in os.walk(directory):
        dirs[:]=[d for d in dirs if d not in ['node_modules','.git','target','build','dist']]
        for file in files:
            if re.match(r'^(licen[sc]e|copying|copyright|notice|ofl)([._-].*|$)',file,re.I):
                path=pathlib.Path(base)/file
                try: body=path.read_text(errors='strict')
                except (UnicodeError,OSError): continue
                results.append((str(path.relative_to(directory)),body))
    return sorted(results)
def command(args,cwd=ROOT):
    return subprocess.check_output(args,cwd=cwd,text=True)
for cwd,platforms in [(ROOT,['windows','linux']),(ROOT/'experiments/mobile',['android','ios'])]:
    data=json.loads(command(['pnpm','licenses','list','--prod','--json'],cwd))
    installed={}
    for base,dirs,files in os.walk(cwd/'node_modules'):
        if 'package.json' in files:
            try:
                meta=json.loads((pathlib.Path(base)/'package.json').read_text())
                if meta.get('name') and meta.get('version'): installed[(meta['name'],meta['version'])]=pathlib.Path(base)
            except (ValueError,OSError): pass
        dirs[:]=[d for d in dirs if d=='node_modules' or d.startswith('@') or pathlib.Path(base).name in ['node_modules','.pnpm'] or pathlib.Path(base).name.startswith('@')]
    for license,packages in data.items():
        for pkg in packages:
            for version in pkg['versions']:
                p=installed.get((pkg['name'],version))
                if p is None:
                    candidates=[pathlib.Path(path) for path in pkg['paths'] if (pathlib.Path(path)/'package.json').exists()]
                    p=next((path for path in candidates if json.loads((path/'package.json').read_text()).get('version')==version),None)
                if p is None: raise RuntimeError('未找到已安装依赖: '+pkg['name']+'@'+version)
                source=pkg.get('homepage') or 'https://www.npmjs.com/package/'+pkg['name']+'/v/'+version
                if not isinstance(source,str) or not source.startswith('https://'): source='https://www.npmjs.com/package/'+pkg['name']+'/v/'+version
                put(pkg['name'],version,license,source,platforms,documents(p))
for manifest,platform,targets,roots in [
    ('Cargo.toml','macos',['aarch64-apple-darwin'],['folio-ffi']),
    ('Cargo.toml','ios',['aarch64-apple-ios'],['folio-ffi']),
    ('Cargo.toml','android',['aarch64-linux-android','x86_64-linux-android'],['folio-ffi']),
    ('apps/desktop-ui/src-tauri/Cargo.toml','windows',['x86_64-pc-windows-msvc','aarch64-pc-windows-msvc'],['folio-desktop']),
    ('apps/desktop-ui/src-tauri/Cargo.toml','linux',['x86_64-unknown-linux-gnu','aarch64-unknown-linux-gnu'],['folio-desktop'])]:
    for target in targets:
        data=json.loads(command(['cargo','metadata','--locked','--format-version','1','--manifest-path',manifest,'--filter-platform',target]))
        packages={p['id']:p for p in data['packages']}; nodes={n['id']:n for n in data['resolve']['nodes']}
        pending=[p['id'] for p in data['packages'] if p['name'] in roots]; active=set()
        while pending:
            ident=pending.pop()
            if ident in active: continue
            active.add(ident); pending.extend(nodes[ident]['dependencies'])
        for ident in sorted(active):
            pkg=packages[ident]
            if pkg['source'] is None: continue
            put(pkg['name'],pkg['version'],pkg['license'],pkg.get('repository') or 'https://crates.io/crates/'+pkg['name']+'/'+pkg['version'],[platform],documents(pathlib.Path(pkg['manifest_path']).parent))
put('Folio',json.loads((ROOT/'apps/desktop-ui/package.json').read_text())['version'],'AGPL-3.0-only','https://github.com/aurysian-yan/Folio',['macos','windows','linux','ios','android'],[('LICENSE',(ROOT/'LICENSE').read_text())])
for name,licensefile,url in [('Inter','fixtures/fonts/licenses/Inter-OFL.txt','https://github.com/rsms/inter'),('Source Serif 4','fixtures/fonts/licenses/SourceSerif-OFL.txt','https://github.com/adobe-fonts/source-serif'),('JetBrains Mono','apps/desktop-ui/src/assets/fonts/JetBrainsMono-OFL.txt','https://github.com/JetBrains/JetBrainsMono')]:
    put(name,'','OFL-1.1',url,['macos','windows','linux','ios','android'],[('OFL',(ROOT/licensefile).read_text())])
third=ROOT/'experiments/mobile/modules/folio-native/android/third-party'
nativeSources=[
 ('NexioSchedule','291e8b9b57c8f331d8f189c52553f41dfd0ce017','AGPL-3.0-only','https://github.com/HaoZai000/NexioSchedule/tree/291e8b9b57c8f331d8f189c52553f41dfd0ce017','NexioSchedule-LICENSE.txt'),
 ('Kyant0 AndroidLiquidGlass','','Apache-2.0','https://github.com/Kyant0/AndroidLiquidGlass','AndroidLiquidGlass-LICENSE.txt'),
 ('Kyant0 Capsule','','Apache-2.0','https://github.com/Kyant0/Capsule','Capsule-LICENSE.txt'),
 ('MeiloX','1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29','GPL-3.0-only','https://github.com/NEORUAA/MeiloX/tree/1d830d3f9cd11294e2bb977c7d0ba77f0fb8ca29','MeiloX-LICENSE.txt'),
 ('Phosphor native icons','3.0.6','MIT','https://github.com/duongdev/phosphor-react-native','Phosphor-LICENSE.txt'),
 ('AndroidX Gaussian blur','7e1430f6c57df22b6ceeaa66ff4e18b53a67edd9','Apache-2.0','https://android.googlesource.com/platform/frameworks/support/+/7e1430f6c57df22b6ceeaa66ff4e18b53a67edd9','Apache-2.0.txt'),
 ('Kyant shaders','','Apache-2.0','https://github.com/Kyant0/AndroidLiquidGlass','Kyant-Shaders-NOTICE.txt')]
for name,version,license,url,filename in nativeSources:
    docs=[(filename,(third/'META-INF/licenses/folio-navigation'/filename).read_text())]
    apache=third/'META-INF/licenses/folio-navigation/Apache-2.0.txt'
    if license=='Apache-2.0' and apache.exists(): docs.append(('Apache-2.0',apache.read_text()))
    put(name,version,license,url,['android'],docs)
put('Claralight Slider','7b98a2bf93234847cc19ac040fc29c9323159047','MIT','https://github.com/ClaralightDesign/react/blob/7b98a2bf93234847cc19ac040fc29c9323159047/packages/claralight/package.json',['windows','linux'],[('package.json','"license": "MIT"')])
entries[next(k for k in entries if k[0]=='Claralight Slider')]['declarationOnly']=True
pods=ROOT/'experiments/mobile/ios/Pods/Target Support Files/Pods-FolioDev/Pods-FolioDev-acknowledgements.plist'
iosSnapshot=ROOT/'shared/about/ios-notices.json'
if pods.exists():
    iosItems=plistlib.loads(pods.read_bytes()).get('PreferenceSpecifiers',[])
    iosSnapshot.write_text(json.dumps(iosItems,ensure_ascii=False,indent=2)+'\n')
elif iosSnapshot.exists(): iosItems=json.loads(iosSnapshot.read_text())
else: raise RuntimeError('缺少 iOS 原生许可快照')
for item in iosItems:
    if item.get('Title') and item.get('FooterText') and item['Title'] not in ['Acknowledgements','']:
        put(item['Title'],'','See notices','https://cocoapods.org/pods/'+item['Title'],['ios'],[('Acknowledgements',item['FooterText'])])
# Android 运行依赖由 Gradle 的已解析配置提供，保留 Maven POM 的许可声明。
coords=ROOT/'shared/about/android-dependencies.txt'
if coords.exists():
    native=json.loads((ROOT/'shared/about/native-notices.json').read_text())
    for line in coords.read_text().splitlines():
        if not line.strip(): continue
        group,name,version=line.split(':'); item=native[line]; pom=item['pom']
        if not pom: raise RuntimeError('缺少 Maven POM: '+line)
        tree=ET.fromstring(pom); ns={'m':'http://maven.apache.org/POM/4.0.0'}
        licenses=[ET.fromstring(decl) for decl in item.get('licenseDeclarations',[])] or tree.findall('.//m:licenses/m:license',ns)
        decl='\n'.join(ET.tostring(x,encoding='unicode') for x in licenses)
        label=' OR '.join(x.findtext('m:name','',ns) for x in licenses) or 'See notices'
        docs=item['documents']+([('POM license declaration',decl)] if decl else [])
        repo='https://dl.google.com/dl/android/maven2/' if group.startswith('androidx.') or group=='com.google.android.material' else 'https://repo.maven.apache.org/maven2/'
        if group=='org.rustls': repo='https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/'
        source=repo+'/'.join([group.replace('.','/'),name,version,name+'-'+version+'.pom'])
        put(group+':'+name,version,label,source,['android'],docs)
        entries[next(k for k in entries if k[0]==group+':'+name and k[1]==version)]['declarationOnly']=not bool(item['documents'])
fingerprintFiles=['Cargo.lock','apps/desktop-ui/src-tauri/Cargo.lock','pnpm-lock.yaml','experiments/mobile/pnpm-lock.yaml','experiments/mobile/modules/folio-native/android/build.gradle','experiments/mobile/modules/folio-native/ios/FolioNative.podspec','shared/about/android-dependencies.txt','shared/about/native-notices.json','shared/about/ios-notices.json']
fingerprints={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in fingerprintFiles}
OUT.write_text(json.dumps({'schemaVersion':1,'fingerprints':fingerprints,'entries':sorted(entries.values(),key=lambda x:(x['name'].lower(),x['version'])),'texts':texts},ensure_ascii=False,indent=2)+'\n')
print(str(len(entries))+' entries; '+str(len(texts))+' original documents')

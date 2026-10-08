#!/usr/bin/env python3
# 收集 Android 原生产物内的原始许可与 Maven 声明。
import concurrent.futures,io,json,pathlib,re,subprocess,urllib.request,zipfile,tempfile,shutil,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[2]
cache=pathlib.Path.home()/'.gradle/caches/modules-2/files-2.1'
output=subprocess.check_output(['./gradlew','--no-daemon','-I',str(ROOT/'tools/about/android-licenses.gradle'),':app:folioLicenseCoordinates'],cwd=ROOT/'experiments/mobile/android',text=True)
coordinates=sorted(set(re.findall(r'^FOLIO_COORD:(.+)$',output,re.M)))
if not coordinates: raise RuntimeError('未读取到 Android 运行依赖')
def notices(archive):
    result=[]
    with zipfile.ZipFile(archive) as z:
        for filename in z.namelist():
            if re.match(r'^(license|notice|copying|copyright)([._-].*|$)',filename.rsplit('/',1)[-1],re.I):
                try: result.append([filename,z.read(filename).decode('utf-8')])
                except UnicodeError: pass
        if 'classes.jar' in z.namelist(): result.extend(notices(io.BytesIO(z.read('classes.jar'))))
    return result
previousPath=ROOT/'shared/about/native-notices.json'
previous=json.loads(previousPath.read_text()) if previousPath.exists() else {}
def licenseDeclaration(pom, depth=0):
    tree=ET.fromstring(pom); ns={'m':'http://maven.apache.org/POM/4.0.0'}
    values=tree.findall('m:licenses/m:license',ns)
    if values: return [ET.tostring(value,encoding='unicode') for value in values]
    parent=tree.find('m:parent',ns)
    if parent is None or depth>=4: return []
    group=parent.findtext('m:groupId','',ns); name=parent.findtext('m:artifactId','',ns); version=parent.findtext('m:version','',ns)
    if not group or not name or not version or '$' in version: return []
    path='/'.join([group.replace('.','/'),name,version,name+'-'+version+'.pom'])
    for repo in ['https://repo.maven.apache.org/maven2/','https://dl.google.com/dl/android/maven2/']:
        try:
            with urllib.request.urlopen(repo+path,timeout=25) as response: inherited=response.read().decode('utf-8')
            return licenseDeclaration(inherited,depth+1)
        except (OSError,ValueError): continue
    return []
def collect(line):
    group,name,version=line.split(':'); base=cache/group/name/version; docs=[]
    archives=[artifact for artifact in base.glob('*/*') if artifact.suffix in ['.aar','.jar'] and not artifact.name.endswith('-sources.jar')]
    for artifact in archives: docs.extend(notices(artifact))
    poms=list(base.glob('*/*.pom')); pom=poms[0].read_text() if poms else None
    if not pom:
        path='/'.join([group.replace('.','/'),name,version,name+'-'+version+'.pom'])
        repos=['https://dl.google.com/dl/android/maven2/','https://repo.maven.apache.org/maven2/']
        if group=='org.rustls': repos.insert(0,'https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/')
        for repo in repos:
            try:
                with urllib.request.urlopen(repo+path,timeout=25) as response: pom=response.read().decode('utf-8')
                break
            except (OSError,ValueError): continue
    if not pom: pom=previous.get(line,{}).get('pom')
    if not pom: raise RuntimeError('未取得原始 POM: '+line)
    if not docs: docs=previous.get(line,{}).get('documents',[])
    if not archives and not docs:
        tree=ET.fromstring(pom); packaging=tree.findtext('{http://maven.apache.org/POM/4.0.0}packaging') or 'jar'
        if packaging in ['aar','jar']:
            artifactPath='/'.join([group.replace('.','/'),name,version,name+'-'+version+'.'+packaging])
            artifactRepos=['https://dl.google.com/dl/android/maven2/','https://repo.maven.apache.org/maven2/']
            if group=='org.rustls': artifactRepos.insert(0,'https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/')
            for repo in artifactRepos:
                try:
                    with urllib.request.urlopen(repo+artifactPath,timeout=30) as response, tempfile.TemporaryFile() as file:
                        shutil.copyfileobj(response,file); file.seek(0); docs=notices(file)
                    break
                except (OSError,ValueError,zipfile.BadZipFile): continue
    return line,{'pom':pom,'documents':docs,'licenseDeclarations':licenseDeclaration(pom)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: data=dict(pool.map(collect,coordinates))
(ROOT/'shared/about/android-dependencies.txt').write_text('\n'.join(coordinates)+'\n')
previousPath.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('已收集 '+str(len(data))+' 项 Android 原生依赖')

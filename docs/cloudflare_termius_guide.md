# 이중 공유기 환경 Cloudflare Tunnel 및 Termius 연동 가이드

## 1. 개요
이 문서는 이중 NAT(공유기 2대 병렬 연결) 환경의 우분투(Ubuntu 24.04) 홈 서버를 **포트포워딩 없이 외부에서 안전하게 접속**하기 위한 가이드입니다. 특히, Mac 클라이언트 환경에서 `Termius` 앱을 사용하여 번거로운 명령어 입력 없이 원클릭으로 접속할 수 있도록 **백그라운드 자동 터널링(LaunchAgent)**을 구축하는 방법을 포함합니다.

---

## 2. 작동 원리
1. **서버 측:** Cloudflare Zero Trust 대시보드에서 터널을 생성하고, 서버(우분투)에 `cloudflared` 데몬을 설치하여 터널을 연결합니다.
2. **도메인 라우팅:** `ssh.haezean.com` 등의 도메인을 터널 내부의 `localhost:22` 로 연결(Published application routes)합니다.
3. **클라이언트 측(Mac):** Termius는 외부 프로그램을 끌어오는 기능(`ProxyCommand`)을 지원하지 않습니다. 따라서 Mac 자체에 `cloudflared`를 백그라운드 서비스(LaunchAgent)로 띄워 **가상의 로컬 포트(127.0.0.1:2222)**를 항상 열어둡니다.
4. **접속:** Termius는 항상 켜져 있는 가상의 로컬 포트로 접속하여 최종적으로 우분투 서버에 도달합니다.

---

## 3. 설정 단계

### 3.1. 서버(우분투) 쪽 터널 설정 (Cloudflare 대시보드)
1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)에 접속합니다.
2. **Networks ➡️ Tunnels** 메뉴로 이동 후 `Create a tunnel`을 클릭합니다.
3. 터널 종류로 **Cloudflared**를 선택하고 이름을 지정합니다.
4. OS 환경으로 **Debian ➡️ 64-bit**를 선택한 후, 나오는 설치 명령어 뭉치(token 포함)를 복사합니다.
5. 우분투 서버 터미널에 복사한 명령어를 붙여넣고 실행하여 데몬을 설치합니다.
6. Cloudflare 대시보드에서 `Next`를 누른 뒤, 상단의 **[Published application routes]** (또는 Hostname routes) 탭에서 도메인을 라우팅합니다.
   - **Subdomain:** `ssh` (원하는 서브도메인)
   - **Domain:** `haezean.com` (자신의 도메인 선택)
   - **Service Type:** `SSH`
   - **Service URL:** `localhost:22`
7. 설정을 저장하면 서버 쪽 셋업은 모두 완료됩니다. 기존 공유기의 22번 포트포워딩은 삭제해도 무방합니다.

### 3.2. Mac 클라이언트 필수 패키지 설치
Mac 터미널을 열고 Homebrew를 이용해 `cloudflared`를 설치합니다.

```bash
brew install cloudflared
```

### 3.3. Mac 부팅 시 터널 자동 실행 등록 (LaunchAgent)
Termius 접속을 편리하게 하기 위해, Mac이 켜질 때 터널이 항상 백그라운드에서 실행되도록 설정합니다.

1. 터미널에서 아래 명령어를 입력하여 자동 실행 스크립트 파일을 만듭니다.
   ```bash
   nano ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist
   ```
2. 아래 XML 코드를 복사하여 붙여넣습니다. (아래 코드는 Apple Silicon(M1/M2/M3) 기준 경로인 `/opt/homebrew/bin/cloudflared`를 포함하고 있습니다.)
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.user.cloudflared.ssh</string>
       <key>ProgramArguments</key>
       <array>
           <string>/opt/homebrew/bin/cloudflared</string> 
           <string>access</string>
           <string>tcp</string>
           <string>--hostname</string>
           <string>ssh.haezean.com</string>
           <string>--url</string>
           <string>127.0.0.1:2222</string>
       </array>
       <key>RunAtLoad</key>
       <true/>
       <key>KeepAlive</key>
       <true/>
   </dict>
   </plist>
   ```
3. `control + O` ➡️ `엔터` ➡️ `control + X` 를 눌러 저장하고 편집기를 빠져나옵니다.
4. 아래 명령어를 실행하여 서비스를 즉시 백그라운드에 등록 및 실행합니다.
   ```bash
   launchctl load ~/Library/LaunchAgents/com.user.cloudflared.ssh.plist
   ```

### 3.4. Termius 접속 설정
이제 Mac 측에서 모든 준비가 끝났습니다.

1. **Termius** 앱을 실행합니다.
2. 새로운 접속(New Host)을 생성합니다.
3. 접속 정보를 다음과 같이 입력합니다.
   - **Address:** `127.0.0.1`
   - **Port:** `2222`
   - **Username:** 우분투 서버의 사용자 계정
   - **Password:** 우분투 서버의 비밀번호
4. 설정을 저장하고 연결 버튼을 더블 클릭하면 접속이 완료됩니다.

---
**💡 팁:** 이후부터는 Mac 부팅 시마다 가상의 2222 포트가 자동으로 열리므로, 별도의 스크립트 실행 없이 Termius만 켜서 바로 접속하시면 됩니다.

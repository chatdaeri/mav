# 마브 서버 Railway 템플릿 만들기 (챗대리 관리자용)

구독자가 README의 "Deploy on Railway" 버튼 하나로 마브 서버를 띄울 수 있게, 챗대리 Railway 계정에 템플릿을 한 번 공개하는 절차예요. GitHub 저장소 `chatdaeri/mav`가 공개된 뒤에 진행해요.

## 1. 템플릿 만들기

1. Railway 대시보드 → **Templates** → **New Template**
2. 서비스 두 개를 추가해요.
   - **Postgres**: Database → PostgreSQL. 볼륨은 기본값(`/var/lib/postgresql/data`)
   - **mav-server**: GitHub Repo → `chatdaeri/mav`, 브랜치 `main`
3. `mav-server`의 **Variables → Raw Editor**에 아래 6줄을 그대로 붙여 넣어요. 등호 앞뒤에 띄어쓰기를 넣지 않고, 따옴표도 쓰지 않아요.

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=${{secret(32)}}
BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
PORT=8080
RAILWAY_DOCKERFILE_PATH=app/apps/server/Dockerfile
BAALDA_DEPLOYMENT=self-hosted
```

4. `mav-server` → **Settings → Networking**에서 공개 도메인을 만들고 포트를 **8080**으로 지정해요.
5. 저장한 뒤 Raw Editor를 다시 열어 6줄이 한 번씩만 있는지 확인해요. 두 번 붙여 넣으면 같은 줄이 겹쳐요.
6. **Publish**를 누르고 템플릿 이름을 `mav-server`로 정해요. 공개 주소가 `https://railway.com/deploy/mav-server`가 되면 README의 버튼 주소와 맞아요.

## 2. 값마다 하는 일

| 값 | 하는 일 |
|---|---|
| `DATABASE_URL` | 같이 만든 Postgres에 연결 |
| `JWT_SECRET` | 배포할 때마다 새로 만드는 비밀키. 템플릿에 고정값을 넣으면 모든 서버가 같은 키를 쓰게 되니 꼭 이 식 그대로 둬요 |
| `BETTER_AUTH_URL` | 서버 자기 주소. 초대 링크가 이 주소로 만들어져요 |
| `PORT` | Railway 공개 도메인이 연결되는 포트 |
| `RAILWAY_DOCKERFILE_PATH` | 서버 이미지 빌드 위치 |
| `BAALDA_DEPLOYMENT` | `self-hosted` = 요금제 제한 없음. 내부 이름이라 Baalda라는 글자가 남아 있어요 |

메모리 한도는 저장소의 `railway.json`에서 1GB로 정해져요. 소규모 팀이면 충분해요.

## 3. 선택 설정

- **초대 메일·비밀번호 찾기**: `EMAIL_FROM`과 `RESEND_API_KEY`(또는 `SMTP_URL`)를 추가하면 켜져요. 없으면 참여 코드로 팀원을 받아요.
- **구글 로그인**: Google OAuth 클라이언트 ID·Secret을 넣으면 켜져요. 마브 기본 설정에서는 쓰지 않아요.

## 4. 확인

1. 새 Railway 계정으로 템플릿 버튼을 눌러 배포해요.
2. `https://<주소>/health`가 `{"ok":true,...}`를 돌려주는지 봐요.
3. 마브 → 팀 서버 연결 → 주소 붙여 넣기 → 가입 → 노트 만들기
4. 다른 컴퓨터에서 `https://<주소>/open/connect` 링크로 들어와 참여 코드로 합류 → 같은 노트를 동시에 고쳐 봐요.

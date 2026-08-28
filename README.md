# 요트다이스 (Yacht Dice) — 실시간 대전

Cloudflare Workers + Durable Objects 기반의 2인 실시간 대전 요트다이스(야찌) 웹앱입니다.
5개의 주사위는 CSS 3D 큐브로 렌더링되어 굴릴 때마다 실제로 회전하며, 두 플레이어의
주사위 결과·선택한 칸·점수가 WebSocket으로 실시간 동기화됩니다.

## 구조

- `public/` — 프론트엔드 (정적 파일, 빌드 도구 없음)
  - `index.html`, `style.css`
  - `js/dice3d.js` — CSS 3D 주사위 큐브 렌더링/회전 애니메이션
  - `js/scoring.js` — 점수 계산 규칙 (서버와 동일 로직, 미리보기 점수 표시용)
  - `js/main.js` — 로비/대기실/게임 화면 전환, WebSocket 클라이언트
- `src/worker.js` — Cloudflare Worker 엔트리 (정적 자산 서빙 + `/ws` 라우팅)
- `src/game-room.js` — Durable Object. 방 하나당 인스턴스 하나, 게임 상태의 단일
  진실 공급원(source of truth). 두 소켓에 상태를 브로드캐스트합니다.
- `src/scoring.js` — 서버 측 점수 계산 (클라이언트 파일과 동일 내용을 중복 보관)

## 게임 규칙

- Minor(1~6 눈) 합계가 63점 이상이면 보너스 +35점
- Major: 3 of a Kind / 4 of a Kind(전체 합), Full House(25), Small Straight(30),
  Large Straight(40), YATZY(50), Chance(전체 합)
- 두 플레이어는 각자 독립적으로 13개 칸을 채워나가며(동시 진행), 상대의 주사위/선택/점수를
  실시간으로 볼 수 있습니다. 13칸을 모두 채운 총점이 높은 쪽이 승리합니다.

## 로컬 개발

```bash
npm install
npm run dev
```

`http://localhost:8787` 에서 두 개의 브라우저 탭(또는 시크릿창)으로 같은 초대 코드에
접속하면 로컬에서 대전을 테스트할 수 있습니다.

## 배포 (Cloudflare Workers)

```bash
npx wrangler login   # 최초 1회, 브라우저에서 Cloudflare 계정 인증
npm run deploy        # = wrangler deploy
```

배포가 끝나면 `https://yacht-dice.<your-subdomain>.workers.dev` 형태의 URL이 출력됩니다.
이후 코드를 수정하고 다시 `npm run deploy`를 실행하면 같은 URL에 새 버전이 즉시 반영됩니다
(버전 업데이트 = 재배포).

### 커스텀 도메인을 쓰고 싶다면

Cloudflare 대시보드 → Workers & Pages → `yacht-dice` → Settings → Domains & Routes
에서 원하는 도메인을 연결하세요.

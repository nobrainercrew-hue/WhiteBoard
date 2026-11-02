# 판서 화이트보드 · 함께 그리기

터치, S펜, 마우스로 여러 사람이 같은 보드에 실시간으로 그리는 화이트보드입니다.

## Render에 올리기

1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. Render 대시보드에서 **New → Web Service**를 고르고 저장소를 연결합니다.
3. 설정값
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 배포가 끝나면 `https://<이름>.onrender.com` 에 접속합니다. 새 보드가 열리고 주소가 `/b/xxxx` 로 바뀝니다.
5. 오른쪽 위 사람 버튼을 누르면 링크가 복사됩니다. 그 링크를 받은 사람은 같은 보드에 들어옵니다.

## 내 컴퓨터에서 실행

```
npm install
npm start
```

그다음 http://localhost:3000 을 엽니다.

## 저장

- 보드 내용은 서버의 `data/` 폴더에 보드별 JSON으로 저장됩니다.
- Render 무료 플랜은 디스크가 재시작 때 지워질 수 있습니다. 보드를 오래 보관하려면 Persistent Disk를 붙이고 환경 변수 `DATA_DIR`을 그 경로로 지정하세요.

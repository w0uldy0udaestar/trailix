# TODOS

## Windows 네이티브 경로 지원 (v1 범위 밖)
- **What**: WSL이 아닌 Windows 네이티브 Claude Code 사용자 지원 — `~/.claude/projects` 경로 형식, 홈 디렉토리, 경로 구분자 처리.
- **Why**: 오픈소스 사용자 상당수가 Windows 네이티브. v1은 WSL/Linux/macOS(POSIX)만.
- **Pros**: 사용자층 확대. **Cons**: 경로 처리 복잡도, 테스트 환경 필요.
- **Context**: 설계 시점(2026-07-07)에 경로 처리를 모듈 하나로 격리해두기로 함 — 이 TODO가 들어올 때 그 모듈만 확장하면 되도록. 설계 문서: `~/.gstack/projects/range/rladn-unknown-design-20260707-174407.md`
- **Depends on**: v1 출시 후 Windows 사용자 수요(이슈) 확인.

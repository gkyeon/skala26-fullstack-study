# Git 명령어 참고

> 이 문서는 Git이 궁금할 때 보는 참고 자료입니다. 평소 배포는 강의 제작
> 스튜디오의 **VS Code로 열기** 버튼과 VS Code 소스 제어 화면을 사용하는
> 방법을 권장합니다.

## 1. 현재 변경사항 확인

```bash
git status
git diff
```

- `git status`: 새로 만들거나 수정한 파일 목록을 확인합니다.
- `git diff`: 아직 커밋하지 않은 실제 변경 내용을 확인합니다.

## 2. 새 강의 파일만 선택

아래 경로는 예시입니다. 실제로 만든 강의 폴더명으로 바꿔야 합니다.

```bash
git add lectures/04-example/index.html index.html
git diff --cached
```

- `git add`: 이번에 배포할 파일만 선택합니다.
- `git diff --cached`: 선택한 내용이 맞는지 커밋 전에 다시 확인합니다.
- `git add .`은 관계없는 작업까지 함께 선택할 수 있으므로 사용하지 않습니다.

## 3. 커밋하고 GitHub로 전송

```bash
git commit -m "add: 새 강의 추가"
git push origin main
```

- 커밋 메시지에는 어떤 강의를 추가하거나 수정했는지 적습니다.
- `git push` 후 GitHub Pages 반영에는 보통 1~2분 정도 걸립니다.

## 4. 기존 강의 내용만 수정한 경우

```bash
git add lectures/03-example/index.html
git diff --cached
git commit -m "docs: 03 강의 내용 수정"
git push origin main
```

## 5. 잘못 선택한 파일 빼기

아직 커밋하지 않았다면 다음 명령으로 선택만 취소할 수 있습니다.

```bash
git restore --staged -- lectures/04-example/index.html
```

파일 내용은 지워지지 않고, 커밋할 파일 목록에서만 빠집니다.

## 사용하지 않는 명령

이 저장소에서는 다음 명령을 배포 용도로 사용하지 않습니다.

```text
git push --force
git reset --hard
git clean -fd
```

작업이나 파일을 잃을 수 있으므로 문제가 생기면 명령을 추가로 실행하지 말고
현재 `git status` 화면부터 확인합니다.

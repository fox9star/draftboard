'use strict';
/* Draftboard helper — a chat widget on every page. It answers with the local AI model
   (Ollama) when available and falls back to searching the built-in help topics. */
(() => {
  if (window.top !== window.self || new URLSearchParams(location.search).has('demo')) return;

  const HISTORY_KEY = 'draftboard.chat.history', AI_KEY = 'draftboard.chat.ai';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- help topics (used for the AI's knowledge and for the offline answers) ----------
  const KB = [
    { t: 'Draftboard로 할 수 있는 것', k: ['무엇', '뭘', '뭐 할', '기능', '모듈', '할 수 있', '소개', 'draftboard', '드래프트보드'],
      a: 'Draftboard는 브라우저에서 실행되는 로컬 디자인 도구이고 모듈은 10가지입니다. 디자인 & 프로토타입(화면 디자인과 클릭해 넘겨 보는 시안), 슬라이드(발표 자료와 슬라이드 쇼), AI 빌더(설명을 적으면 로컬 AI가 웹 앱을 만듦), 일러스트(펜·불리언·그라디언트로 그리는 벡터 그림), 미디어 플로(이미지·동영상·오디오를 노드로 이어 처리), 사이트(반응형 웹사이트로 내보내기), 개발 모드(레이어의 CSS·HTML·React 코드 보기), 대량 제작(템플릿과 표 데이터로 이미지 일괄 생성), 모션(레이어 애니메이션과 동영상), 화이트보드(스티커 메모와 연결선으로 아이디어 정리). [내 파일](files.html)의 ‘새로 만들기’에서 시작하세요.' },
    { t: '요금', k: ['무료', '결제', '요금', '가격', '유료', '크레딧', '가입', '회원', '돈'],
      a: '무료입니다. 계정, 요금제, 크레딧이 없고 설치도 필요 없습니다.' },
    { t: '파일 저장 위치', k: ['저장', '어디에', '사라', '데이터', 'indexeddb', '자동 저장'],
      a: '파일은 브라우저 저장소(IndexedDB)에 자동 저장되고, 에디터 위쪽에 ‘저장됨’으로 표시됩니다. 브라우저 데이터를 지우면 함께 사라지니 [내 파일](files.html)의 **백업**이나 에디터 메뉴(☰) → ‘JSON 파일로 저장’으로 내려받아 두세요. 저장 공간은 브라우저와 접속 주소마다 따로입니다.' },
    { t: '백업과 가져오기', k: ['백업', '복원', '가져오기', 'json', '다른 컴퓨터', '다른 pc', '다른 브라우저'],
      a: '[내 파일](files.html)의 **백업**을 누르면 모든 파일이 백업 파일 하나로 저장됩니다. 다른 브라우저나 주소에서 **가져오기**로 그 파일을 고르면 한 번에 복원됩니다. 파일 하나만 옮기려면 파일 카드의 ⋯ → ‘JSON 파일로 내보내기’를 쓰세요.' },
    { t: '로컬 서버 파일을 호스팅 사이트로 옮기기', k: ['이 pc 파일', '로컬 서버', '127.0.0.1', '호스팅', 'github', '깃허브', '파일이 안 보', '파일이 없', '옮기'],
      a: '호스팅 사이트(github.io)와 로컬 서버(127.0.0.1:8080)는 저장 공간이 따로입니다. 호스팅 사이트의 [내 파일](files.html)에서 **이 PC 파일 가져오기**를 누르고, 새 창에서 받는 주소를 확인한 뒤 **보내기**를 누르세요. 로컬 서버가 실행 중이어야 합니다. 같은 파일을 다시 옮기면 사본 없이 최신 내용으로 갱신됩니다.' },
    { t: '테마', k: ['테마', '다크', '라이트', '그레이', '어둡', '밝게', '화면 색'],
      a: '각 화면 위쪽의 테마 스위치(☀ 라이트, ◐ 그레이, ☾ 다크)나 에디터 메뉴(☰) → 테마에서 바꿉니다. 선택은 저장되고 열려 있는 다른 탭에도 적용됩니다. 캔버스 배경을 기본 색으로 둔 파일은 테마를 따라 바뀝니다.' },
    { t: '새 파일 만들기', k: ['새 파일', '새로 만들', '파일 만들', '시작하'],
      a: '[내 파일](files.html)의 ‘새로 만들기’에서 종류(디자인, 슬라이드, 일러스트, 사이트, 대량 제작, 모션, 화이트보드)를 고르면 새 파일이 열립니다. 에디터에서는 메뉴(☰) → 새로 만들기로도 만들 수 있습니다.' },
    { t: '단축키', k: ['단축키', '키보드', '단축 키', '핫키'],
      a: '이동 V, 손 도구 H(또는 Space+드래그), 프레임 F, 사각형 R, 원 O, 선 L, 화살표 Shift+L, 펜 P, 연필 Shift+P, 형광펜 M, 텍스트 T, 스티커 메모 S, 연결선 X, 스탬프 E. 그룹 Ctrl+G, 복제 Ctrl+D, 실행 취소 Ctrl+Z, 전체 단축키 보기 Ctrl+/.' },
    { t: '텍스트', k: ['텍스트', '글자', '글씨', '폰트', '글꼴', '행간', '줄 간격'],
      a: 'T를 누르고 캔버스를 클릭하면 바로 입력합니다. 끌면 고정 너비 상자가 됩니다. 텍스트를 더블클릭하거나 선택하고 Enter를 누르면 다시 편집하고, Esc로 끝냅니다. 오른쪽 디자인 탭에서 글꼴·굵기·크기·행간·정렬과 자동/고정 너비를 바꿉니다.' },
    { t: '펜으로 그리기', k: ['펜', '곡선', '베지어', '패스'],
      a: 'P로 펜을 고릅니다. 캔버스를 클릭하면 꺾인 점(직선)이, 누른 채 끌면 곡선 점과 핸들이 생깁니다. 처음 찍은 점을 다시 누르면 모양이 닫히고, Enter나 Esc를 누르거나 더블클릭하면 열린 채로 끝납니다. 그린 뒤 점을 고치려면 ‘점 편집’을 쓰세요.' },
    { t: '점 편집', k: ['점 편집', '앵커', '핸들', ['점', '수정'], ['점', '고치'], ['벡터', '바꾸'], '벡터로'],
      a: '다 그린 벡터를 더블클릭하면 점 편집 모드가 됩니다. 점이나 핸들을 끌어 고치고, 점을 더블클릭하면 곡선 점과 꺾인 점이 바뀌며, Delete로 점을 지웁니다. Esc나 Enter로 끝냅니다. 사각형 같은 도형은 Ctrl+E로 벡터로 바꿀 수 있습니다.' },
    { t: '일러스트 파일', k: ['일러스트', '벡터 그림', '그림 그리', '그림을 그리'],
      a: '일러스트는 벡터 그림을 그리기 위한 파일 종류입니다. [내 파일](files.html)의 ‘일러스트’로 만들면 펜 경로, 불리언, 그라디언트로 그린 예제 그림과 ‘펜으로 그리기’ 버튼이 함께 열립니다. 그린 그림은 내보내기에서 SVG나 PNG로 저장합니다.' },
    { t: '불리언', k: ['불리언', '합치기', '빼기', '교차', '제외', '합집합', '도형 합'],
      a: '도형을 둘 이상 선택하고 Ctrl+Alt+U(합치기), Ctrl+Alt+S(빼기), Ctrl+Alt+I(교차), Ctrl+Alt+E(제외)를 누르거나 우클릭 메뉴에서 고릅니다. 빼기는 맨 아래 도형에서 나머지를 뺍니다. 불리언을 선택하면 디자인 탭에서 연산을 바꾸거나 ‘도형으로 분리’할 수 있습니다.' },
    { t: '색, 그라디언트, 효과', k: ['색', '채우기', '그라디언트', '그라데이션', '그림자', '흐림', '블러', '테두리', '선 두께', '투명'],
      a: '디자인 탭의 채우기에서 단색·선형 그라디언트·원형 그라디언트를 고릅니다. 선에서는 색·두께·파선/점선과 화살표 모양을, 효과에서는 그림자와 레이어 흐림을 정합니다. 불투명도는 레이어 항목의 % 값입니다.' },
    { t: '프레임', k: ['프레임', '대지', '아트보드', '화면 크기', '프리셋'],
      a: 'F로 프레임을 그리거나, 프레임을 선택하고 디자인 탭의 ‘크기 프리셋’(데스크톱, 모바일, 슬라이드 16:9, SNS 등)을 고릅니다. 프레임 안의 레이어는 프레임과 함께 움직입니다. 레이어들을 선택하고 Ctrl+Alt+G를 누르면 프레임으로 감쌉니다.' },
    { t: '그룹과 정렬', k: ['그룹', '정렬', '맞추', '간격', '분배', '가운데'],
      a: 'Ctrl+G로 그룹, Ctrl+Shift+G로 해제합니다. 디자인 탭 맨 위 아이콘으로 왼쪽·가운데·오른쪽·위·아래 정렬과 간격 균등을 합니다. 레이어 하나만 선택하면 그 레이어를 담은 프레임 기준으로 정렬됩니다. Alt를 누른 채 다른 레이어를 가리키면 두 레이어 사이 간격이 보입니다.' },
    { t: '회전과 크기', k: ['회전', '돌리', '크기 조절', '크기를', '비율'],
      a: '선택한 레이어의 모서리 바로 바깥을 끌면 회전합니다(Shift를 누르면 15°씩). 핸들을 끌면 크기가 바뀌고 Shift를 누르면 비율을 유지합니다. 디자인 탭에 각도와 X·Y·W·H를 숫자로 넣을 수도 있습니다.' },
    { t: '레이어 패널', k: ['레이어', '숨기', '잠금', '순서', '앞으로', '뒤로', '이름 바꾸'],
      a: '왼쪽 레이어 패널에서 눈 아이콘으로 숨기고 자물쇠로 잠급니다. 끌어서 순서를 바꾸고 더블클릭해 이름을 바꿉니다. Ctrl+] / Ctrl+[ 로 한 칸 앞뒤, Ctrl+Shift+] / Ctrl+Shift+[ 로 맨 앞·맨 뒤로 보냅니다.' },
    { t: '이미지 넣기', k: ['이미지', '사진', '그림 넣', '붙여넣'],
      a: '이미지 파일을 캔버스에 끌어 놓거나, 복사한 이미지를 Ctrl+V로 붙여 넣거나, 도구 막대의 이미지 버튼(Ctrl+Shift+K)을 누릅니다. 디자인 탭에서 맞춤 방식을 고르고 ‘이미지 바꾸기’로 교체합니다.' },
    { t: '내보내기', k: ['내보내', 'png', 'svg', 'pdf', '다운로드', '이미지로 저장'],
      a: '에디터 오른쪽 위 **내보내기**에서 PNG, SVG, 이미지 복사, PDF(슬라이드 인쇄), JSON, 사이트 미리보기·HTML, 동영상(WebM), 애니메이션 SVG를 고릅니다. 프레임 하나를 선택하면 그 프레임 영역만 내보내고, PNG 배율은 디자인 탭 맨 아래에서 정합니다.' },
    { t: '프로토타입', k: ['프로토타입', '링크', '클릭하면', '화면 전환', '화면 연결'],
      a: '버튼 같은 레이어를 선택하고 오른쪽 **프로토타입** 탭의 ‘클릭하면’에서 이동할 프레임과 전환 효과를 고릅니다. 위쪽 ▶(Ctrl+Alt+Enter)로 재생하고, 연결이 없는 곳을 누르면 누를 수 있는 곳이 깜빡입니다.' },
    { t: '슬라이드 추가', k: ['슬라이드', '새 슬라이드', ['슬라이드', '추가'], ['슬라이드', '만들'], ['슬라이드', '넣']],
      a: '슬라이드 파일에서 슬라이드를 선택하고 **Enter**를 누르면 그 다음에 새 슬라이드가 추가됩니다. 아무것도 선택하지 않고 Enter를 누르면 맨 끝에 추가됩니다. 왼쪽 슬라이드 탭의 ‘+ 새 슬라이드’를 누르면 레이아웃(제목, 제목과 본문, 2단 구성 등)을 골라 추가할 수 있습니다.' },
    { t: '슬라이드 복제와 순서', k: ['슬라이드', ['슬라이드', '복제'], ['슬라이드', '순서'], ['슬라이드', '복사'], ['슬라이드', '지우']],
      a: '슬라이드를 선택하고 Ctrl+D를 누르면 복제본이 원본 바로 다음 순서로 추가됩니다. 왼쪽 슬라이드 탭에서 썸네일을 끌어 순서를 바꾸고, 슬라이드를 선택하고 Delete를 누르면 지웁니다.' },
    { t: '슬라이드 쇼와 PDF', k: ['슬라이드', '슬라이드 쇼', '발표', '프레젠테이션', '발표자 노트', '피피티', 'ppt', ['슬라이드', 'pdf']],
      a: '위쪽 ▶ 또는 왼쪽 ‘재생’으로 슬라이드 쇼를 시작합니다. → 또는 Space로 다음, ←로 이전 슬라이드로 가고, N으로 발표자 노트를 보며, Esc로 끝냅니다. 발표자 노트는 슬라이드(프레임)를 선택하고 디자인 탭 아래쪽에 적습니다. PDF는 내보내기 → ‘PDF (슬라이드 인쇄)’를 누른 뒤 인쇄 창에서 ‘PDF로 저장’을 고릅니다.' },
    { t: '화이트보드', k: ['화이트보드', '스티커', '메모', '연결선', '스탬프', '형광펜', '타이머', '브레인스토밍'],
      a: 'S를 누르고 클릭하면 스티커 메모가 생기고 바로 글자를 씁니다. X를 누르고 도형에서 도형으로 끌면 연결선이 붙어 도형을 따라옵니다. E는 스탬프, M은 형광펜이고, 오른쪽 ‘화이트보드 도구’의 타이머로 시간을 잴 수 있습니다.' },
    { t: '사이트 만들기', k: ['사이트', '웹사이트', '반응형', '페이지 이름', '중단점'],
      a: '프레임을 선택하고 디자인 탭 **사이트**에서 페이지 이름과 화면 크기(데스크톱·태블릿·모바일)를 정합니다. 페이지 이름이 같은 프레임은 화면 크기별 버전으로 묶이고, 프로토타입 링크가 페이지 링크가 됩니다. 내보내기 → ‘사이트 미리보기’ 또는 ‘사이트 HTML 내보내기’를 누르세요.' },
    { t: '개발 모드', k: ['개발 모드', '코드', 'css', 'react', 'tailwind', '개발자', 'html 코드'],
      a: '레이어를 선택하고 오른쪽 **코드** 탭을 엽니다. 속성 표와 CSS·HTML·React·Tailwind·SVG 코드가 나오고 복사하거나 내려받을 수 있습니다. [내 파일](files.html)의 ‘개발 모드’ 카드를 누르면 파일을 코드 탭이 열린 상태로 엽니다.' },
    { t: '대량 제작', k: ['대량', '일괄', 'csv', '엑셀', '템플릿', '여러 장'],
      a: '템플릿 프레임 안의 텍스트·이미지 레이어 이름을 데이터의 열 이름과 같게 맞춥니다. 내보내기 → ‘대량 제작…’에서 CSV나 표를 붙여 넣고 ‘캔버스에 만들기’ 또는 ‘PNG 묶음(ZIP)으로 내보내기’를 누릅니다.' },
    { t: '모션', k: ['모션', '애니메이션', '움직', '동영상', 'webm', '타임라인'],
      a: '레이어를 선택하고 오른쪽 **모션** 탭에서 효과(페이드 인, 아래에서 올라오기, 통통 튀며 떨어지기 등)와 지연·길이·곡선·반복을 정합니다. 타임라인에서 순서를 보고 ▶ 재생하며, 동영상(WebM)·애니메이션 SVG·HTML로 내보냅니다.' },
    { t: 'AI 빌더', k: ['ai 빌더', '앱 만들', '앱을 만들', '코드 생성', '프롬프트'],
      a: '[AI 빌더](make.html)에서 만들고 싶은 앱을 설명하면 이 PC의 AI 모델이 HTML 앱을 만들어 오른쪽에서 바로 실행합니다. 결과를 보고 고쳐 달라고 이어서 요청하세요. ‘디자인 가져오기’로 프레임을 코드로 불러와 동작을 붙일 수도 있습니다.' },
    { t: '미디어 플로', k: ['미디어 플로', '노드', '워크플로', '프레임 추출', '파형', '오디오'],
      a: '[미디어 플로](weave.html)에서 왼쪽 목록의 노드를 추가하고, 노드 오른쪽 점(출력)에서 다른 노드의 왼쪽 점(입력)으로 끌어 연결합니다. ▶ 실행하면 결과가 노드에 보이고, ‘결과 보기·저장’ 노드에서 저장하거나 ‘Draftboard로 보내기’로 파일에 넣습니다.' },
    { t: '로컬 AI(Ollama) 설정', k: ['ollama', '올라마', 'ai 연결', '연결이 안', 'ai가 안', '모델', '로컬 ai', '권한'],
      a: 'AI 기능은 이 PC에서 실행되는 Ollama를 씁니다. Ollama를 설치해 실행하고 터미널에서 `ollama pull qwen2.5:7b`로 모델을 받으세요. 로컬 서버(127.0.0.1:8080)에서는 이것으로 충분합니다. 호스팅 사이트에서 쓰려면 환경 변수 OLLAMA_ORIGINS에 사이트 주소를 넣어야 합니다. Windows에서는 PowerShell에서 `[Environment]::SetEnvironmentVariable(\'OLLAMA_ORIGINS\', \'https://fox9star.github.io\', \'User\')`를 실행하고 Ollama를 다시 시작하세요. 그다음 도우미의 ‘로컬 AI 연결’을 누르고, 브라우저가 로컬 네트워크 접근을 물으면 ‘허용’을 누르세요.' },
    { t: '실행 취소', k: ['실행 취소', '되돌', '다시 실행', '취소'],
      a: 'Ctrl+Z로 실행 취소, Ctrl+Shift+Z(또는 Ctrl+Y)로 다시 실행합니다. 에디터 위쪽의 ↶ ↷ 버튼도 있습니다.' },
    { t: '오프라인과 공동 편집', k: ['오프라인', '인터넷', '공동', '같이 편집', '협업', '공유'],
      a: '인터넷 없이도 편집과 내보내기가 됩니다. 실시간 공동 편집은 지원하지 않으니 JSON 파일이나 백업 파일로 주고받으세요.' },
    { t: '홈 버튼과 메뉴', k: ['홈', '메뉴', '파일 목록', '돌아가'],
      a: '에디터 왼쪽 위 로고는 홈페이지로 이동합니다(작업은 먼저 저장됩니다). 옆의 ☰ 메뉴에는 파일 목록, 새로 만들기, JSON 저장·열기, 이미지 넣기, 단축키, 테마가 있습니다.' },
    { t: '확대와 화면 이동', k: ['확대', '축소', '줌', '화면 이동', '스크롤'],
      a: 'Ctrl+휠 또는 Ctrl+= / Ctrl+- 로 확대·축소하고, Shift+1 전체 맞춤, Shift+2 선택 맞춤, Shift+0 100%입니다. Space를 누른 채 끌거나 휠로 화면을 옮깁니다.' },
  ];

  const SUGGEST = {
    'index.html': ['무엇을 만들 수 있나요?', '정말 무료인가요?', 'AI 기능은 어떻게 켜나요?'],
    'files.html': ['새 파일은 어떻게 만드나요?', '다른 브라우저로 파일을 옮기려면?', '백업은 어떻게 하나요?'],
    'editor.html': ['펜 도구 사용법', '슬라이드 추가하는 법', 'PNG로 내보내려면?', '단축키 알려줘'],
    'make.html': ['AI 빌더 사용법', 'AI 연결이 안 돼요'],
    'weave.html': ['노드는 어떻게 연결하나요?', '결과를 저장하려면?'],
  };
  const PAGE_NAMES = { 'index.html': '홈페이지', 'files.html': '파일 목록', 'editor.html': '에디터', 'make.html': 'AI 빌더', 'weave.html': '미디어 플로' };
  const page = () => location.pathname.split('/').pop() || 'index.html';

  // ---------- offline answers ----------
  // A key is a word, or a list of words that must all appear. Topics far below the best match are dropped.
  function search(q) {
    const t = q.toLowerCase();
    const score = k => (Array.isArray(k)
      ? (k.every(w => t.includes(w)) ? k.join('').length + 4 : 0)
      : (t.includes(k) ? k.length + 2 : 0));
    const hits = KB.map(e => ({ e, s: e.k.reduce((sum, k) => sum + score(k), 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    if (!hits.length) return [];
    return hits.filter(x => x.s >= hits[0].s * 0.6).slice(0, 2).map(x => x.e);
  }

  function helpAnswer(q) {
    const hits = search(q);
    if (!hits.length) return { text: '도움말에서 맞는 내용을 찾지 못했습니다. 아래 주제 중에서 골라 보시거나, 다른 말로 물어봐 주세요.', topics: true };
    return { text: hits.map((e, i) => (hits.length > 1 ? `**${e.t}**\n` : '') + e.a).join('\n\n') };
  }

  // ---------- AI ----------
  function context() {
    const p = page();
    let c = `접속 주소: ${location.origin}${hosted() ? ' (호스팅 사이트)' : ' (이 PC의 로컬 서버)'}
사용자가 지금 보고 있는 화면: ${PAGE_NAMES[p] || '홈페이지'}`;
    const Ed = window.Ed;
    if (Ed && Ed.s && Ed.s.doc) {
      const sel = Ed.selNodes ? Ed.selNodes() : [];
      const types = [...new Set(sel.map(n => (Ed.TYPE_LABEL || {})[n.type] || n.type))].join(', ');
      const tabs = { design: '디자인', proto: '프로토타입', motion: '모션', code: '코드' };
      c += ` (${(Ed.KINDS || {})[Ed.s.doc.kind] || ''} 파일 ‘${Ed.s.doc.name}’, 선택한 레이어 ${sel.length}개${types ? `: ${types}` : ''}, 오른쪽 탭: ${tabs[Ed.s.rightTab] || ''})`;
    }
    return c;
  }

  function systemPrompt() {
    return `당신은 Draftboard의 도우미입니다. Draftboard는 브라우저에서 실행되는 무료 로컬 디자인 도구입니다.
규칙:
- 한국어로 짧고 정확하게 답하세요. 단계가 있으면 번호 목록으로 쓰세요.
- 답은 한국어로만 쓰고 다른 나라 말 단어를 섞지 마세요. 영어는 도움말에 나온 키 이름(Ctrl, Shift, Enter 등)과 파일 형식 이름(PNG, SVG 등)만 씁니다.
- 아래 도움말에 있는 기능만 설명하고, 없는 기능은 지어내지 마세요. 모르면 모른다고 말하고 가장 가까운 기능을 안내하세요.
- 질문에 ‘참고할 도움말’이 붙어 있으면 그 내용을 빠짐없이 전달하되 순서와 표현을 크게 바꾸지 말고, 도움말에 없는 단계·옵션·메뉴 이름은 덧붙이지 마세요.
- 명령어, 주소, 코드는 도움말에 적힌 그대로 쓰고 바꾸거나 지어내지 마세요. 설정 파일을 지어내지 마세요.
- 단축키와 버튼 이름은 도움말에 적힌 그대로 쓰세요.
- 다른 화면으로 안내할 때는 [이름](주소) 형식의 링크를 쓰세요. 쓸 수 있는 주소: files.html, make.html, weave.html, index.html
- Draftboard와 관계없는 질문에는 한두 문장으로 답하고 Draftboard 이야기로 돌아오세요.
${context()}

Draftboard 모듈: 디자인 & 프로토타입, 슬라이드, AI 빌더, 일러스트, 미디어 플로, 사이트, 개발 모드, 대량 제작, 모션, 화이트보드

도움말:
${KB.map(e => `## ${e.t}\n${e.a}`).join('\n\n')}`;
  }

  // Chinese and Japanese script; Korean answers never need it
  const FOREIGN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

  const hosted = () => !!(window.LocalAI && LocalAI.hosted && LocalAI.hosted());
  let ai = { state: 'unknown', model: '' };
  let connecting = null;

  async function connect() {
    if (!window.LocalAI) { ai.state = 'off'; return false; }
    if (connecting) return connecting;
    ai.state = 'checking';
    renderStatus();
    connecting = (async () => {
      try {
        ai.model = await LocalAI.pickModel();
        ai.state = 'on';
        try { localStorage.setItem(AI_KEY, 'on'); } catch (e) { /* remembered for this page only */ }
      } catch (e) {
        ai.state = 'off';
        ai.error = LocalAI.explain(e);
      }
      connecting = null;
      renderStatus();
      return ai.state === 'on';
    })();
    return connecting;
  }

  // ---------- history ----------
  let history = [];
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { history = []; }
  const saveHistory = () => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40))); } catch (e) { /* history stays in this page */ }
  };

  // ---------- rendering ----------
  function md(text) {
    const inline = s => esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
        const h = href.replace(/&amp;/g, '&');
        const safe = /^(https:\/\/|[a-z0-9-]+\.html(\?[^\s]*)?(#[^\s]*)?$|#)/i.test(h) && !/^javascript:/i.test(h);
        return safe ? `<a href="${esc(h)}"${/^https:/.test(h) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>` : label;
      });
    const out = [];
    let list = null;
    for (const line of String(text).split('\n')) {
      const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
      if (m) {
        const ordered = /^\s*\d/.test(line);
        if (!list || list.ordered !== ordered) { if (list) out.push(list.close); list = { ordered, close: ordered ? '</ol>' : '</ul>' }; out.push(ordered ? '<ol>' : '<ul>'); }
        out.push(`<li>${inline(m[1])}</li>`);
        continue;
      }
      if (list) { out.push(list.close); list = null; }
      out.push(line.trim() ? `<p>${inline(line)}</p>` : '');
    }
    if (list) out.push(list.close);
    return out.join('');
  }

  const css = `
.dbchat{--c-bg:#ffffff;--c-fg:#1e1e1e;--c-muted:#8a8a92;--c-line:#e7e7ea;--c-soft:#f4f4f6;--c-accent:#0d8bff;position:fixed;right:var(--chat-right,20px);bottom:var(--chat-bottom,20px);z-index:85;font:13px/1.55 "Pretendard","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;color:var(--c-fg)}
:root[data-theme="gray"] .dbchat{--c-bg:#4a4a4f;--c-fg:#f2f2f4;--c-muted:#b8b8be;--c-line:#5d5d63;--c-soft:#56565c}
:root[data-theme="dark"] .dbchat{--c-bg:#232326;--c-fg:#ececee;--c-muted:#8e8e95;--c-line:#36363b;--c-soft:#2d2d31}
.dbchat *{box-sizing:border-box}
.dbchat [hidden]{display:none!important}
.dbchat-fab{width:52px;height:52px;border-radius:50%;border:0;cursor:pointer;color:#fff;background:linear-gradient(135deg,#7B61FF,#0D8BFF);box-shadow:0 8px 24px rgba(13,139,255,.35);display:grid;place-items:center;transition:transform .15s}
.dbchat-fab:hover{transform:translateY(-2px)}
.dbchat-fab:focus-visible{outline:3px solid #7B61FF;outline-offset:3px}
.dbchat-panel{position:absolute;right:0;bottom:64px;width:370px;height:min(560px,calc(100vh - 110px));display:flex;flex-direction:column;background:var(--c-bg);border:1px solid var(--c-line);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden}
.dbchat-head{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;border-bottom:1px solid var(--c-line);user-select:none}
.dbchat-title{font-weight:800;font-size:14px}
.dbchat-status{display:flex;align-items:center;gap:5px;color:var(--c-muted);font-size:11px;margin-right:auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dbchat-status em{font-style:normal;overflow:hidden;text-overflow:ellipsis}
.dbchat-status i{width:7px;height:7px;border-radius:50%;background:#b0b0b8;flex:none}
.dbchat-status.on i{background:#18a058}
.dbchat-status.checking i{background:#f5a524}
.dbchat-icon{width:28px;height:28px;border:0;border-radius:6px;background:none;color:var(--c-muted);cursor:pointer;display:grid;place-items:center;flex:none}
.dbchat-icon:hover{background:var(--c-soft);color:var(--c-fg)}
.dbchat-connect{border:1px solid var(--c-line);background:var(--c-soft);color:var(--c-fg);border-radius:6px;font:inherit;font-size:11px;padding:3px 8px;cursor:pointer;flex:none}
.dbchat-log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.dbchat-msg{max-width:88%;padding:9px 12px;border-radius:14px;word-break:break-word}
.dbchat-msg p{margin:0}.dbchat-msg p+p{margin-top:6px}
.dbchat-msg ul,.dbchat-msg ol{margin:4px 0;padding-left:18px}
.dbchat-msg code{font:12px ui-monospace,Consolas,monospace;background:rgba(127,127,127,.18);padding:0 4px;border-radius:4px}
.dbchat-msg a{color:var(--c-accent)}
.dbchat-msg.user{align-self:flex-end;background:var(--c-accent);color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}
.dbchat-msg.bot{align-self:flex-start;background:var(--c-soft);border-bottom-left-radius:4px}
.dbchat-msg.bot .src{display:block;margin-top:6px;color:var(--c-muted);font-size:11px}
.dbchat-msg.bot .refs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:8px;color:var(--c-muted);font-size:11px}
.dbchat-msg.bot .refs button{border:1px solid var(--c-line);background:var(--c-bg);color:var(--c-fg);border-radius:10px;padding:1px 8px;font:inherit;font-size:11px;cursor:pointer}
.dbchat-msg.bot .refs button:hover{border-color:var(--c-accent)}
.dbchat-typing{display:inline-flex;gap:3px}.dbchat-typing span{width:6px;height:6px;border-radius:50%;background:var(--c-muted);animation:dbchat-dot 1s infinite}
.dbchat-typing span:nth-child(2){animation-delay:.15s}.dbchat-typing span:nth-child(3){animation-delay:.3s}
@keyframes dbchat-dot{0%,100%{opacity:.25}50%{opacity:1}}
.dbchat-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
.dbchat-chips button{border:1px solid var(--c-line);background:var(--c-bg);color:var(--c-fg);border-radius:14px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
.dbchat-chips button:hover{background:var(--c-soft)}
.dbchat-form{display:flex;gap:8px;align-items:flex-end;padding:10px 12px 12px;border-top:1px solid var(--c-line)}
.dbchat-form textarea{flex:1;resize:none;max-height:120px;min-height:38px;border:1px solid var(--c-line);border-radius:10px;padding:8px 10px;font:inherit;color:var(--c-fg);background:var(--c-bg);outline:none}
.dbchat-form textarea:focus{border-color:var(--c-accent)}
.dbchat-send{width:38px;height:38px;border:0;border-radius:10px;background:var(--c-accent);color:#fff;cursor:pointer;display:grid;place-items:center;flex:none}
.dbchat-send:disabled{opacity:.5;cursor:default}
.dbchat-backdrop{display:none;position:fixed;inset:0;background:rgba(10,10,14,.45)}
.dbchat.max.open .dbchat-backdrop{display:block}
.dbchat.max.open .dbchat-fab{visibility:hidden}
.dbchat.max .dbchat-panel{position:fixed;inset:24px;width:auto;height:auto;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.dbchat.max .dbchat-log,.dbchat.max .dbchat-chips,.dbchat.max .dbchat-form{padding-left:max(14px,calc((100% - 780px) / 2));padding-right:max(14px,calc((100% - 780px) / 2))}
.dbchat.max .dbchat-msg{font-size:14px}
@media (max-width:520px){.dbchat-panel{position:fixed;inset:8px 8px 76px 8px;width:auto;height:auto}.dbchat.max .dbchat-panel{inset:0;border-radius:0;border:0}}
@media print{.dbchat{display:none!important}}`;

  const ICON_CHAT = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 9.5h7M8.5 12.5h4"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 2.5l12 5.5-12 5.5 1.8-5.5z"/></svg>';
  const ICON_MAX = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/></svg>';
  const ICON_RESTORE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v4h4M9 7l4.5-4.5M7 13V9H3M7 9l-4.5 4.5"/></svg>';
  const MAX_KEY = 'draftboard.chat.max';

  let root, panel, log, input, sendBtn, chips, statusEl, connectBtn, maxBtn, busy = false, abort = null;

  function renderStatus() {
    if (!statusEl) return;
    statusEl.className = 'dbchat-status ' + ai.state;
    statusEl.querySelector('em').textContent = ai.state === 'on' ? `로컬 AI · ${ai.model}` : ai.state === 'checking' ? 'AI 연결 확인 중…' : '도움말 모드';
    statusEl.title = ai.state === 'off' && ai.error ? ai.error : '';
    connectBtn.hidden = ai.state === 'on' || ai.state === 'checking' || !window.LocalAI;
    connectBtn.textContent = ai.state === 'off' ? 'AI 다시 연결' : '로컬 AI 연결';
  }

  function bubble(m) {
    if (m.role === 'user') return `<div class="dbchat-msg user">${esc(m.content)}</div>`;
    const body = m.content ? md(m.content) : '<span class="dbchat-typing"><span></span><span></span><span></span></span>';
    const refs = m.refs && m.refs.length && m.content
      ? `<span class="refs">관련 도움말: ${m.refs.map(t => `<button type="button" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</span>` : '';
    return `<div class="dbchat-msg bot">${body}${m.src === 'help' ? '<span class="src">도움말에서 찾은 답입니다</span>' : ''}${refs}</div>`;
  }

  function renderLog() {
    if (!history.length) {
      log.innerHTML = bubble({ role: 'bot', content: '안녕하세요, **Draftboard 도우미**입니다. 사용법이나 기능을 물어보세요.' + (ai.state === 'on' ? '' : '\nAI에 연결되지 않아도 도움말에서 답을 찾아 드립니다.') });
    } else log.innerHTML = history.map(bubble).join('');
    log.scrollTop = log.scrollHeight;
    renderChips();
  }

  function renderChips(topics) {
    const list = topics ? KB.slice(0, 8).map(e => e.t) : (SUGGEST[page()] || SUGGEST['index.html']);
    chips.innerHTML = list.map(t => `<button type="button">${esc(t)}</button>`).join('');
    chips.hidden = !topics && history.length > 0;
  }

  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    history.push({ role: 'user', content: text });
    const reply = { role: 'bot', content: '' };
    history.push(reply);
    renderLog();
    busy = true;
    sendBtn.disabled = true;
    const useAI = ai.state === 'on' || (ai.state === 'unknown' && !hosted() && await connect());
    let refs = [];
    if (useAI) {
      refs = search(text);
      const msgs = [{ role: 'system', content: systemPrompt() }];
      for (const m of history.slice(-10, -2)) msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
      // The most relevant help topics go right next to the question
      msgs.push({ role: 'user', content: refs.length ? `${text}\n\n(참고할 도움말)\n${refs.map(e => `## ${e.t}\n${e.a}`).join('\n\n')}` : text });
      abort = new AbortController();
      let drifted = false;
      try {
        await LocalAI.chat({
          model: ai.model, messages: msgs, signal: abort.signal, options: { temperature: 0.1 },
          onToken: (piece, full) => {
            reply.content = full;
            // Small local models sometimes drift into Chinese or Japanese; stop there.
            if (FOREIGN.test(piece)) { drifted = true; abort.abort(); return; }
            const last = log.lastElementChild;
            if (last) last.outerHTML = bubble(reply);
            log.scrollTop = log.scrollHeight;
          },
        });
      } catch (e) {
        if (e.name !== 'AbortError') {
          ai.state = 'off';
          ai.error = LocalAI.explain(e);
          renderStatus();
          const h = helpAnswer(text);
          reply.content = h.text;
          reply.src = 'help';
        } else if (!drifted) reply.content = '';
      }
      if (reply.src !== 'help' && reply.content) {
        // Drop any line with foreign script; if little is left, give the help text instead.
        const clean = reply.content.split('\n').filter(l => !FOREIGN.test(l)).join('\n').trim();
        if (FOREIGN.test(reply.content) && clean.length < 30) {
          reply.content = helpAnswer(text).text;
          reply.src = 'help';
        } else {
          reply.content = clean;
          reply.src = 'ai';
          reply.refs = refs.map(e => e.t);
        }
      }
      abort = null;
    } else {
      const h = helpAnswer(text);
      reply.content = h.text;
      reply.src = 'help';
      renderLog();
      if (h.topics) renderChips(true);
    }
    if (!reply.content) history.pop();
    busy = false;
    sendBtn.disabled = false;
    saveHistory();
    renderLog();
    if (reply.src === 'help' && /찾지 못했습니다/.test(reply.content)) renderChips(true);
  }

  // the maximized size is remembered, so the helper opens the same way on every page
  function setMax(on, remember = true) {
    root.classList.toggle('max', on);
    const label = on ? '작게 보기' : '크게 보기';
    maxBtn.innerHTML = on ? ICON_RESTORE : ICON_MAX;
    maxBtn.title = label;
    maxBtn.setAttribute('aria-label', label);
    if (remember) {
      try { if (on) localStorage.setItem(MAX_KEY, '1'); else localStorage.removeItem(MAX_KEY); } catch (e) { /* not remembered */ }
    }
    log.scrollTop = log.scrollHeight;
  }

  function open() {
    panel.hidden = false;
    root.classList.add('open');
    root.querySelector('.dbchat-fab').setAttribute('aria-expanded', 'true');
    let remembered = false;
    try { remembered = localStorage.getItem(AI_KEY) === 'on'; } catch (e) { /* not remembered */ }
    if (ai.state === 'unknown' && (!hosted() || remembered)) connect().then(renderLog);
    renderStatus();
    renderLog();
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    panel.hidden = true;
    root.classList.remove('open');
    root.querySelector('.dbchat-fab').setAttribute('aria-expanded', 'false');
    if (abort) abort.abort();
  }

  function mount() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'dbchat';
    root.innerHTML = `<div class="dbchat-backdrop"></div>
      <section class="dbchat-panel" role="dialog" aria-label="Draftboard 도우미" hidden>
        <header class="dbchat-head"><span class="dbchat-title">도우미</span><span class="dbchat-status"><i></i><em></em></span>
          <button type="button" class="dbchat-connect" hidden>로컬 AI 연결</button>
          <button type="button" class="dbchat-icon" data-act="clear" title="대화 지우기" aria-label="대화 지우기">${ICON_TRASH}</button>
          <button type="button" class="dbchat-icon" data-act="max"></button>
          <button type="button" class="dbchat-icon" data-act="close" title="닫기 (Esc)" aria-label="닫기">${ICON_CLOSE}</button></header>
        <div class="dbchat-log" aria-live="polite"></div>
        <div class="dbchat-chips"></div>
        <form class="dbchat-form"><textarea rows="1" placeholder="무엇이든 물어보세요 (Enter로 보내기)" aria-label="질문"></textarea><button type="submit" class="dbchat-send" aria-label="보내기">${ICON_SEND}</button></form>
      </section>
      <button type="button" class="dbchat-fab" title="도우미" aria-label="도우미 열기" aria-expanded="false">${ICON_CHAT}</button>`;
    document.body.appendChild(root);
    panel = root.querySelector('.dbchat-panel');
    log = root.querySelector('.dbchat-log');
    input = root.querySelector('textarea');
    sendBtn = root.querySelector('.dbchat-send');
    chips = root.querySelector('.dbchat-chips');
    statusEl = root.querySelector('.dbchat-status');
    connectBtn = root.querySelector('.dbchat-connect');
    maxBtn = root.querySelector('[data-act="max"]');
    let maxed = false;
    try { maxed = localStorage.getItem(MAX_KEY) === '1'; } catch (e) { /* not remembered */ }
    setMax(maxed, false);

    root.querySelector('.dbchat-fab').addEventListener('click', () => (panel.hidden ? open() : close()));
    root.querySelector('.dbchat-backdrop').addEventListener('click', close);
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'close') close();
      if (b && b.dataset.act === 'max') setMax(!root.classList.contains('max'));
      if (b && b.dataset.act === 'clear') { if (abort) abort.abort(); history = []; saveHistory(); renderLog(); }
    });
    root.querySelector('.dbchat-head').addEventListener('dblclick', e => {
      if (!e.target.closest('button')) setMax(!root.classList.contains('max'));
    });
    connectBtn.addEventListener('click', async () => {
      const ok = await connect();
      renderLog();
      if (!ok) {
        history.push({ role: 'bot', content: ai.error || '로컬 AI에 연결하지 못했습니다.', src: '' });
        saveHistory();
        renderLog();
      }
    });
    chips.addEventListener('click', e => { const b = e.target.closest('button'); if (b) send(b.textContent); });
    log.addEventListener('click', e => {
      const b = e.target.closest('[data-topic]');
      const topic = b && KB.find(x => x.t === b.dataset.topic);
      if (!topic || busy) return;
      history.push({ role: 'bot', content: `**${topic.t}**
${topic.a}`, src: 'help' });
      saveHistory();
      renderLog();
    });
    root.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const t = input.value;
      input.value = '';
      input.style.height = '';
      send(t);
    });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); root.querySelector('form').requestSubmit(); }
      if (e.key === 'Escape') close();
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    // keys pressed inside the helper (on its buttons too) must not reach page shortcuts such as the editor's
    panel.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
    });
    renderStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.DraftboardChat = { open, close, send, search, state: () => ({ ...ai, messages: history.length }) };
})();

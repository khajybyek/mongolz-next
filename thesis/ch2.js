const { h1, h2, h3, h4, p, blank, bullet, num, code, quote, table } = require("./helpers");

module.exports = [
  h1("제 2 장   이론적 배경 및 관련 연구"),

  p("본 장은 본 연구가 다루는 핵심 영역 — (1) 네트워크 카메라와 영상관리시스템(VMS) 의 진화, (2) 얼굴 검출 기법, (3) 얼굴 인식 임베딩 모델, (4) 얼굴 마스킹 및 복원 기법, (5) 다중 권한 접근 제어(RBAC·ABAC), (6) 영상 암호화와 키 관리, (7) 웹 보안 모범 사례 — 의 학술적·산업적 발전 과정을 정리한다. 각 영역의 한계점은 본 연구의 설계 결정과 직접 연결되며, 마지막 절에서는 기존 연구의 한계를 종합하여 본 연구가 채워야 할 ‘간극(gap)’ 을 명시한다."),

  h2("2.0  네트워크 카메라와 통합관제 시스템"),
  p("네트워크 카메라(Network Camera, 일명 IP 카메라) 는 영상 캡처·인코딩·전송 기능을 단일 단말에 통합한 임베디드 컴퓨팅 장치이다. 1996년 Axis Communications 가 출시한 NetEye 200 이 최초의 상용 IP 카메라로 평가되며, 이후 H.264(2003) 와 H.265/HEVC(2013) 의 표준화에 따라 대역폭 효율이 비약적으로 향상되어 본격적인 보급기에 진입하였다."),

  h3("2.0.1  주요 프로토콜"),
  bullet("RTSP (Real-Time Streaming Protocol, RFC 7826) — TCP/UDP 위에서 영상 스트림의 PLAY/PAUSE/TEARDOWN 을 제어. 대부분의 상용 IP 카메라가 지원.", 0),
  bullet("ONVIF Profile-S — 영상 스트리밍, PTZ 제어, 사용자 인증을 표준화한 산업 인터페이스. 본 시스템의 카메라 등록 절차는 ONVIF 의 디바이스 디스커버리를 따른다.", 0),
  bullet("HTTP-MJPEG — 단순 HTTP 위에서 멀티파트 JPEG 프레임을 연속 전송. 저가형 카메라와 브라우저 호환성에 강점.", 0),
  bullet("RTMP/SRT — 라이브 방송용 저지연 프로토콜. 본 연구의 1차 지원 범위에서는 제외.", 0),

  h3("2.0.2  영상관리시스템(VMS)"),
  p("VMS(Video Management System) 는 수십∼수천 대의 네트워크 카메라를 단일 콘솔에서 등록·녹화·재생·분석할 수 있도록 통합 관리하는 ‘통합관제 서버 소프트웨어’ 이다. 대표적인 상용 솔루션은 Milestone XProtect, Genetec Security Center, Bosch BVMS 등이며, 오픈 소스에는 ZoneMinder, Shinobi, Frigate 가 있다. 그러나 위에서 언급한 상용·오픈 소스 VMS 의 어느 것도 ‘권한별 차등 마스킹’ 을 일급(first-class) 기능으로 제공하지 않는다. 대부분은 ‘프라이버시 마스크(privacy mask)’ 라는 이름으로 ‘특정 사각 영역만 영구히 가리는’ 기능을 제공할 뿐, 사람·역할 단위의 동적 마스킹은 다루지 않는다."),

  h2("2.1  CCTV 감시 시스템의 진화"),
  p("영상 감시(video surveillance) 의 역사는 1942년 독일이 V-2 로켓 발사 시험을 모니터링하기 위해 설치한 폐쇄회로 시스템에서 출발한다. 그 후 1960년대 미국·영국의 은행과 도심 광장에 본격적으로 보급되면서, ‘CCTV(Closed-Circuit Television)’ 라는 명칭이 일반화되었다. 1세대 시스템은 본질적으로 ‘기록 매체로서의 비디오 테이프’ 와 ‘인간 운영자의 직접 시청’ 에 의존하였으며, 이 시기에는 ‘무엇을 보는가’ 의 결정이 전적으로 인간에게 있었다."),
  p("2세대(1990년대 후반∼2000년대 초) 는 디지털 비디오 레코더(DVR) 와 네트워크 비디오 레코더(NVR) 의 도입으로 특징지어진다. 영상이 디스크에 디지털 형태로 저장되기 시작하면서, 검색·재생·원격 접근의 자유도가 비약적으로 증가하였다. 그러나 자동화된 영상 분석은 여전히 모션 감지(motion detection) 와 같은 단순 신호 처리 수준에 머물러 있었다."),
  p("3세대(2010년대) 는 딥러닝 기반 컴퓨터 비전이 본격적으로 산업 영역에 적용되기 시작한 시기로, ‘지능형 영상 분석(Video Content Analytics, VCA)’ 이라는 용어가 등장하였다. Hikvision, Axis, Bosch 등의 주요 카메라 제조사는 카메라 단말 자체에 객체 검출·번호판 인식 모듈을 내장하기 시작했으며, 클라우드 기반 VMS(Video Management System) 는 다수의 카메라를 통합 관리하면서 동시에 AI 분석 결과를 시각화하는 단일 콘솔을 제공하기 시작하였다."),
  p("4세대(2020년대) 의 핵심 키워드는 ‘프라이버시 보존(privacy-preserving)’ 과 ‘에지(edge) 컴퓨팅’ 이다. EU 의 GDPR(2018), 캘리포니아의 CCPA(2020), 대한민국의 개인정보보호법 개정(2023) 등이 잇따라 시행되면서, 단순히 ‘많이 모으고 잘 인식하는’ 시스템은 법적·사회적 정당성을 상실하고 있다. 본 연구가 표방하는 ‘선택적 식별, 기본 마스킹’ 의 철학은 바로 이 4세대 흐름을 반영한 것이다."),

  h3("2.1.1  CCTV 와 사회 통제"),
  p("Foucault 가 ‘Surveiller et punir’(1975) 에서 제시한 ‘판옵티콘(panopticon)’ 의 비유는 현대 CCTV 사회를 분석하는 기본 도구로 여전히 유효하다. 그는 ‘보이지 않는 감시자가 보일 수 있다는 가능성만으로도 피감시자의 행동이 통제된다’ 는 점을 지적하였고, 이는 도시 CCTV 환경에서 ‘chilling effect’ 로 구체화된다. Norris & Armstrong(1999) 은 영국의 도심 CCTV 가 ‘범죄율 감소’ 보다 ‘범죄의 변위(displacement)’ 에 더 큰 효과를 보였음을 보고하였으며, 이는 ‘감시의 양’ 보다 ‘감시의 질’ 이 중요하다는 본 연구의 입장과 일치한다."),

  h3("2.1.2  법적·윤리적 프레임워크"),
  p("EU GDPR Article 9 은 ‘얼굴 영상 등 생체 정보’ 를 특별 범주(special category) 데이터로 분류하고, 처리에 대해 원칙적 금지 + 명시적 동의·법적 근거의 예외 구조를 채택한다. 대한민국 개인정보보호법 제23조 또한 유사한 구조이며, 2023년 개정으로 ‘민감 정보’ 의 정의에 영상 기반 생체정보가 명문화되었다. 본 연구의 ‘기본 마스킹’ 철학은 이러한 법적 환경에서 ‘처리되는 데이터의 식별성 자체를 기술적으로 제거’ 함으로써 법적 위험을 구조적으로 낮추는 접근이다."),

  h2("2.2  얼굴 검출 기법"),
  p("얼굴 인식 파이프라인은 일반적으로 ‘검출(detection) → 정렬(alignment) → 임베딩(embedding) → 매칭(matching)’ 의 네 단계로 구성된다. 본 절에서는 첫 번째 단계인 검출 기법의 발전을 정리한다."),

  h3("2.2.1  Haar Cascade"),
  p("Viola & Jones(2001) 가 제안한 Haar Cascade 분류기는 적분 영상(integral image), Haar-like 특징, AdaBoost 부스팅, 케스케이드 구조의 네 가지 핵심 아이디어를 결합하여 30fps 의 실시간 얼굴 검출을 최초로 가능하게 한 고전적 알고리즘이다. 단순하고 빠르며 OpenCV 의 기본 구현으로 폭넓게 사용되지만, (1) 다양한 포즈·조명 변화에 취약하고, (2) 정면 얼굴이 아닌 경우 정확도가 급락하며, (3) 작은 얼굴 검출에 한계가 있다."),
  p("본 연구에서는 Haar Cascade 를 단일 검출기로 사용하지 않고, RetinaFace 의 보조 검출기(보완 layer) 로 활용한다. 이유는 (1) RetinaFace 가 놓치는 작은 얼굴을 보완하고, (2) 추론 비용이 거의 무시할 수 있을 만큼 작기 때문이다."),

  h3("2.2.2  HOG + SVM"),
  p("Dalal & Triggs(2005) 의 Histogram of Oriented Gradients(HOG) 와 선형 SVM(Support Vector Machine) 의 결합은 한동안 ‘비-CNN 시대의 표준 검출기’ 로 사용되었다. 영상의 에지 방향을 히스토그램으로 표현하여 회전 불변성을 부분적으로 확보하며, dlib 라이브러리의 기본 검출기로 잘 알려져 있다. 그러나 컨볼루션 기반 검출기에 비해 다양한 회전·차폐 상황에서 성능 저하가 분명하므로, 본 연구에서는 채택하지 않았다."),

  h3("2.2.3  MTCNN"),
  p("Zhang et al.(2016) 의 MTCNN(Multi-task Cascaded Convolutional Network) 은 세 개의 캐스케이드 네트워크(P-Net, R-Net, O-Net) 를 통해 얼굴 영역과 동시에 5개 랜드마크(눈, 코, 입 양 끝) 를 출력한다. 정렬 단계에 직접 입력으로 사용할 수 있다는 장점이 있으며, FaceNet 의 원 논문(Schroff et al., 2015) 에서도 기본 전처리 단계로 사용된다. 그러나 작은 얼굴, 가려진 얼굴에 대한 정확도가 RetinaFace 에 비해 다소 낮다."),

  h3("2.2.4  RetinaFace"),
  p("Deng et al.(2020) 의 RetinaFace 는 단일 단계(single-stage) 다중 작업 학습 구조로, 얼굴 박스, 5개 랜드마크, 그리고 옵션적인 dense 3D 메쉬를 동시에 예측한다. WIDER FACE 의 ‘hard’ 서브셋에서 91.4% AP 를 달성하여 사실상 산업 표준으로 자리 잡았으며, InsightFace 라이브러리의 buffalo_l 패키지에 포함되어 손쉽게 사용할 수 있다."),
  p("본 연구는 RetinaFace 를 1차 검출기로 채택하였으며, 검출 신뢰도 0.55 이상의 박스만 통과시킨다. 이 임계값은 (1) 등록된 용의자에 대한 false negative 방지와, (2) 군중 장면에서의 과도한 박스 수 억제 간의 균형을 고려해 경험적으로 결정되었다."),

  h3("2.2.5  UltraFace-RFB-320"),
  p("브라우저 단(client-side) 얼굴 검출을 위해서는 모델 크기가 작고 ONNX Runtime Web 에서 효율적으로 추론 가능한 모델이 필요하다. UltraFace-RFB-320 은 320×240 입력에서 약 1.04MB 의 ONNX 가중치만으로 실시간 얼굴 검출이 가능하며, 본 연구에서는 ‘업로드 전 사전 검출’ 단계에서 WebGPU(우선) 와 WASM(폴백) 백엔드로 추론된다. 이를 통해 (1) 얼굴이 전혀 없는 영상의 업로드를 사전 차단하고, (2) 서버측 ML 부하를 평균 38% 절감하였다."),

  h3("2.2.6  검출기 비교"),
  table([
    ["검출기", "WIDER Easy", "WIDER Hard", "추론 시간 (T4)", "본 연구 사용"],
    ["Haar Cascade", "78%", "31%", "5 ms", "보조"],
    ["MTCNN", "94%", "70%", "32 ms", "미사용"],
    ["RetinaFace", "96.9%", "91.4%", "28 ms", "1차"],
    ["UltraFace-320", "85%", "62%", "9 ms (브라우저)", "사전 검출"],
  ], [1900, 1500, 1500, 2000, 2460]),

  h2("2.3  얼굴 인식 임베딩 모델"),
  p("‘얼굴 인식(face recognition)’ 의 본질은 ‘같은 사람의 두 얼굴 영상을 가까운 벡터로, 다른 사람의 두 얼굴 영상을 먼 벡터로 매핑하는 함수 f: ℝ^{H×W×3} → ℝ^d 를 학습하는 것’ 이다. 본 절에서는 이러한 임베딩 함수의 발전 과정을 정리한다."),

  h3("2.3.1  Eigenface 와 Fisherface"),
  p("Turk & Pentland(1991) 의 Eigenface 는 PCA(Principal Component Analysis) 를 활용해 얼굴 영상을 저차원 부분 공간에 사영시키고, 그 좌표값을 임베딩으로 사용한다. Fisherface(Belhumeur et al., 1997) 는 LDA(Linear Discriminant Analysis) 를 통해 클래스 간 분산을 최대화한다. 이들 기법은 단순하고 직관적이지만, 조명 변화·표정 변화에 매우 취약하며, 대규모 데이터셋(예: 수십만 명 규모) 에서는 사실상 작동하지 않는다."),

  h3("2.3.2  FaceNet"),
  p("Schroff et al.(2015) 의 FaceNet 은 ‘triplet loss’ 라는 새로운 학습 목표 함수를 도입하였다. 학습 단계에서 anchor·positive·negative 세 개의 영상을 동시에 입력하여, anchor 와 positive 간 거리 d_p, anchor 와 negative 간 거리 d_n 에 대해 d_n − d_p > margin 을 만족하도록 임베딩을 최적화한다. 결과적으로 같은 사람의 두 영상은 유클리드 거리 0.6 미만, 다른 사람의 두 영상은 1.0 초과로 분리된다. LFW 에서 99.63% 의 검증 정확도를 달성하여 사실상 ‘딥 임베딩 시대’ 를 열었다."),

  h3("2.3.3  SphereFace 와 CosFace"),
  p("FaceNet 의 triplet loss 는 학습 효율이 낮고, 하드 네거티브 마이닝(hard negative mining) 에 민감하다는 단점이 있다. SphereFace(Liu et al., 2017) 는 각도(angular) margin 을 softmax 함수에 직접 도입하여 학습을 안정화하였고, CosFace(Wang et al., 2018) 는 코사인 margin 을 도입함으로써 임베딩이 단위 구면(unit hypersphere) 위에 균등하게 분포하도록 유도하였다."),

  h3("2.3.4  ArcFace (본 연구의 선택)"),
  p("Deng et al.(2019) 의 ArcFace 는 ‘각도 단위 margin’ 을 더 직접적으로 softmax 의 결정 경계에 삽입함으로써, 학습 안정성과 식별 정확도를 동시에 향상시켰다. 수식적으로는 다음과 같다:"),
  code("L = -log( exp(s · cos(θ_yi + m)) / ( exp(s · cos(θ_yi + m)) + Σ_{j≠yi} exp(s · cos θ_j) ) )"),
  p("여기서 s 는 스케일 인자(논문 기본값 64), m 은 추가되는 각 margin(논문 기본값 0.5) 이다. InsightFace 의 buffalo_l 패키지에 포함된 ResNet100 기반 ArcFace 는 LFW 에서 99.82%, MegaFace 에서 98.35% 의 정확도를 보고하였다."),
  p("본 연구가 ArcFace 를 채택한 이유는 다음과 같다. 첫째, 512차원 임베딩이 산업 표준이며, PostgreSQL 의 pgvector 확장과 매우 잘 어울린다. 둘째, 학습된 가중치(buffalo_l) 가 비상업·연구용으로 공개되어 있다. 셋째, 다양한 GPU 환경(T4, A10, RTX 4090) 에서 일관된 성능을 보인다. 넷째, 검출(RetinaFace) 과 임베딩(ArcFace) 을 단일 InsightFace 패키지 안에서 통합 운용할 수 있어 종속성 관리가 단순하다."),

  h3("2.3.5  최신 동향 (2023∼2025)"),
  p("AdaFace(Kim et al., 2022), ElasticFace(Boutros et al., 2022), TopoFace(Zheng et al., 2024) 등은 어려운 샘플에 대한 적응형 가중치 또는 토폴로지 보존 기법을 도입함으로써 ArcFace 대비 1∼2%p 의 정확도 향상을 보고하였다. 다만 (1) 가중치가 비공개이거나 비상업 라이선스만 허용되고, (2) 본 연구의 실험 환경(MGZ-Lab) 에서 ArcFace 대비 의미 있는 우위가 관측되지 않아 채택하지 않았다."),

  h2("2.4  프라이버시 보존 기법"),

  h3("2.4.1  비식별화(De-identification) 의 분류"),
  p("Newton et al.(2005) 은 얼굴 영상의 비식별화 기법을 다음 네 가지 범주로 분류하였다 : (1) 가림(masking·blocking), (2) 흐림(blurring), (3) 픽셀화(pixelation), (4) 변형 기반 합성(transform-based synthesis). 처음 세 범주는 ‘원본 영상의 일부 정보를 직접 손실시키는 방식’ 이고, 네 번째는 ‘얼굴의 통계적 특성(예: 평균 얼굴, k-Same-Net)을 합성하여 대체’ 하는 방식이다."),
  p("그러나 모든 기법이 동등한 안전성을 가지지는 않는다. Oh et al.(2016) 은 픽셀화·가우시안 블러로 처리된 영상에 대해 SR(Super-Resolution) 신경망이 평균 64% 의 정확도로 원본을 복원할 수 있음을 보였다. 즉, 가벼운 블러는 ‘비식별화의 환상’ 을 제공할 뿐, 실질적 비가역성을 보장하지 못한다."),

  h3("2.4.2  k-anonymity 와 l-diversity"),
  p("Sweeney(2002) 의 k-anonymity 는 데이터셋 안에서 어떤 레코드도 k-1개 이상의 다른 레코드와 구분 불가능하도록 일반화·억제하는 기법이다. 얼굴 영상의 맥락에서는 Newton 의 k-Same-Pixel(2005) 과 Gross 의 k-Same-Eigen(2008) 이 대표적이다. 이들 기법은 ‘식별 가능성’ 측면에서 강한 보장을 제공하지만, (1) 학습 데이터의 분포에 의존하고, (2) 합성 영상이 인공적·부자연스러운 경우가 많다."),

  h3("2.4.3  GAN 기반 마스킹"),
  p("CIAGAN(Maximov et al., 2020), AnonymousNet(Li et al., 2019), DeepPrivacy(Hukkelås et al., 2019) 등은 GAN(Generative Adversarial Network) 을 활용해 ‘다른 사람처럼 보이지만 원본의 자세·표정·조명이 유지된’ 얼굴을 합성한다. 시각적 자연스러움 측면에서 우수하지만, (1) 합성 얼굴이 우연히 실제 인물과 닮을 수 있다는 ‘재식별 위험’, (2) 모델 학습 시 사용된 데이터셋의 편향이 그대로 전이된다는 한계가 있다."),

  h3("2.4.4  차분 프라이버시(Differential Privacy)"),
  p("Dwork(2006) 가 정식화한 차분 프라이버시는 ‘하나의 레코드를 추가·삭제해도 결과 분포가 ε-bound 만큼만 변화한다’ 는 강한 수학적 보장을 제공한다. 영상 영역에서는 PixelDP(Lecuyer et al., 2019), DP-Image(Yu et al., 2021) 등이 화소 단위 잡음 주입을 시도하였다. 그러나 (1) ε 매개변수의 정량적 의미를 일반 사용자에게 전달하기 어렵고, (2) 영상 인식 모델의 정확도와 직접적으로 trade-off 되며, (3) 본 연구의 목표(‘등록 인물만 식별, 그 외 마스킹’) 와 부합하지 않아 채택하지 않았다."),

  h3("2.4.5  본 연구의 접근 — 큐비스트 모자이크"),
  p("본 연구가 새로 제안하는 큐비스트 모자이크(Cubist Mosaic) 는 위의 (1)∼(4) 범주 중 (1)·(2) 범주의 변형으로 분류할 수 있다. 구체적으로는, 검출된 얼굴 ROI 안에 18∼40개의 보로노이 시드(seed) 를 시드값(seed) 결정적(deterministic) 으로 배치한 후, cv2.Subdiv2D 의 들로네 삼각분할(Delaunay triangulation) 을 거쳐 보로노이 다각형으로 변환하고, 각 다각형 영역의 평균 BGR 색을 채워 넣는 알고리즘이다. 마지막에 경계의 자연스러움을 위해 약한 가우시안 블러(σ=1.5) 를 한 번 더 적용한다."),
  p("이 방식의 장점은 다음과 같다. 첫째, 보로노이 다각형은 무작위로 보이지만 시드값으로 재현 가능하여 ‘같은 얼굴은 같은 모자이크’ 라는 일관성을 유지할 수 있다. 둘째, 각 다각형이 평균색으로 단일화되므로 SR 모델을 적용하더라도 원본 정보의 복원이 사실상 불가능하다. 셋째, 큐비즘 회화 양식과 유사한 시각적 인상을 주어, 사용자 평가에서 단순 픽셀화·블러보다 부담이 적다고 평가받았다."),
  p("자세한 알고리즘 의사 코드와 정량 평가는 제 5 장 5.3절과 제 8 장 8.4절에서 다룬다."),

  h2("2.5  영상 암호화와 키 관리"),

  h3("2.5.1  AES-256-GCM"),
  p("AES(Advanced Encryption Standard) 는 2001년 NIST 가 채택한 128/192/256 비트 키 길이의 블록 암호이며, GCM(Galois/Counter Mode) 은 인증된 암호화(Authenticated Encryption with Associated Data, AEAD) 를 제공하는 운영 모드이다. AES-256-GCM 의 조합은 (1) 256비트 키로 양자 컴퓨터 위협에 대해 128비트 ‘유효 보안 수준’ 을 보장하고, (2) GCM 의 GHASH 가 무결성을 함께 검증하므로 별도의 MAC 이 필요 없으며, (3) CPU 의 AES-NI / PCLMULQDQ 명령어를 사용해 매우 빠르다(인텔 Xeon 기준 3∼5 GB/s)."),

  h3("2.5.2  HKDF 와 키 유도"),
  p("RFC 5869 에 정의된 HKDF(HMAC-based Key Derivation Function) 는 (1) Extract 단계에서 입력 키 자료(IKM) 와 salt 로부터 PRK(Pseudo-Random Key) 를 추출하고, (2) Expand 단계에서 추가 정보(info) 와 함께 임의 길이의 OKM(Output Keying Material) 을 생성한다. 본 연구는 마스터 키 ML_ENCRYPTION_KEY 와 레코딩 ID(UUID v7) 를 입력으로 HKDF-SHA256 을 사용해 레코딩별 32바이트 키를 유도하는 패턴을 채택한다. 이로써 한 레코딩의 키가 유출되더라도 다른 레코딩에 미치는 영향이 격리된다."),

  h3("2.5.3  키 회전 패턴"),
  p("운영 환경에서는 정기적으로 마스터 키를 교체해야 한다. NIST SP 800-57(2020) 은 대칭 키의 권장 회전 주기를 1∼2년으로 제시한다. 그러나 단일 키만 운영하는 경우, 키 교체와 동시에 과거 영상의 복호화가 불가능해지는 ‘운영 절벽’ 이 발생한다."),
  p("본 연구는 이중 키 회전(dual-key rotation) 패턴을 채택한다 : 새로운 키 K_new 가 도입되면, 기존 키 K_old 를 K_prev 로 보관하고, 모든 신규 레코딩은 K_new 로 암호화, 기존 레코딩은 K_old 로 복호화되는 ‘오버랩 윈도우(overlap window)’ 를 운영한다. 모든 기존 레코딩에 대해 K_new 로의 재암호화가 완료되거나, 기존 레코딩이 보관 기간을 초과하면 K_prev 를 폐기한다. 이 패턴의 형식적 안전성 증명은 7장 7.3절에 제시한다."),

  h2("2.6  웹 보안 모범 사례"),

  h3("2.6.1  OWASP Top 10 (2021)"),
  p("OWASP(Open Web Application Security Project) 는 가장 빈번하게 발생하는 10가지 웹 취약점을 격년 단위로 정리한다. 2021년 판은 다음과 같다 : A01 Broken Access Control, A02 Cryptographic Failures, A03 Injection, A04 Insecure Design, A05 Security Misconfiguration, A06 Vulnerable Components, A07 Identification and Authentication Failures, A08 Software and Data Integrity Failures, A09 Security Logging and Monitoring Failures, A10 Server-Side Request Forgery. 본 연구의 침투 시험(7장 7.7절) 은 이 10개 항목을 평가 매트릭스의 기본 축으로 사용한다."),

  h3("2.6.2  Row Level Security"),
  p("Row Level Security(RLS) 는 PostgreSQL 9.5 부터 도입된 기능으로, 테이블의 각 행에 대해 사용자별 SELECT·INSERT·UPDATE·DELETE 정책을 데이터베이스 엔진 내부에서 적용한다. 애플리케이션 계층의 결함이 발생하더라도, RLS 정책에 정합하지 않은 쿼리는 데이터베이스가 응답을 반환하지 않으므로 ‘defense in depth’ 의 핵심 통제 역할을 한다."),
  p("본 연구는 11개 테이블 모두에 RLS 를 적용하고, 사용자의 역할(admin / viewer) 과 소유권(profile_id = auth.uid()) 두 가지 기준으로 정책을 정의하였다. 자세한 정책 매트릭스는 4장 4.3절에 제시한다."),

  h3("2.6.3  Content Security Policy"),
  p("CSP(Content Security Policy) 는 브라우저가 로드할 수 있는 리소스(스크립트, 스타일, 폰트, 이미지) 의 출처(origin) 를 서버가 선언적으로 제한하는 HTTP 응답 헤더이다. 본 연구는 ‘script-src’ 디렉티브에 nonce 기반 정책을 적용하여 인라인 스크립트를 차단하고, ‘report-uri /api/csp-report’ 로 위반 보고서를 Sentry 로 전달한다."),

  h3("2.6.4  TOTP 와 단계 상승 인증"),
  p("RFC 6238 에 정의된 TOTP(Time-Based One-Time Password) 는 공유 비밀과 현재 시간(30초 윈도우) 을 기반으로 6자리 OTP 를 생성한다. 본 연구는 모든 사용자에게 TOTP 2단계 인증을 강제하며, ‘재식별’ 등 강한 영향력을 가진 작업에 대해서는 별도의 ‘15분 단계 상승 토큰’ 을 추가로 요구한다. 이 패턴은 Microsoft 의 ‘Authenticator app’ 과 Google 의 ‘sudo mode’ 에서 영감을 받았다."),

  h2("2.7  기존 연구의 한계와 본 연구의 위치"),
  p("위에서 정리한 선행 연구는 본 연구가 다루는 다섯 가지 P1∼P5 문제 중 일부에 대한 부분적 해법을 제공한다. 그러나 ‘단일 통합 플랫폼 안에서, 정량·정성적으로 검증된, 무중단 운영 가능한 형태로 다섯 문제를 동시에 해결한 사례’ 는 본 연구가 조사한 범위에서는 존재하지 않는다. 본 연구의 위치는 다음 표와 같이 요약된다."),
  table([
    ["선행 연구", "P1 마스킹", "P2 암호화", "P3 권한", "P4 감사", "P5 인증"],
    ["FaceNet (2015)", "—", "—", "—", "—", "—"],
    ["DeepPrivacy (2019)", "○", "—", "—", "—", "—"],
    ["Verkada VMS", "△", "△", "△", "△", "△"],
    ["Hikvision iVMS", "△", "○", "△", "△", "△"],
    ["AWS Rekognition", "—", "○", "○", "○", "△"],
    ["MONGOLZ Security (본 연구)", "◎", "◎", "◎", "◎", "◎"],
  ], [2200, 1400, 1400, 1400, 1400, 1560]),
  p("위 표에서 ◎ 는 ‘정량·정성적 평가를 모두 통과한 강한 통제’, ○ 는 ‘기능이 존재하나 부분적’, △ 는 ‘옵션으로 존재하나 기본값에서는 비활성’, — 는 ‘기능 부재’ 를 의미한다. 본 연구의 모든 칸이 ◎ 로 채워진 것은 본 논문의 핵심 주장이며, 그 정량적 근거는 제 8 장 평가 결과에서 제시된다."),
];

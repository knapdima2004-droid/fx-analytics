# Obchodné stratégie — FX Analytics

## 1. Parabolic SAR (základná stratégia)

Parabolic SAR (Stop and Reverse) je trendový indikátor, ktorý zobrazuje body nad alebo pod cenou.
Keď sú body pod sviečkou — trh je v rastúcom trende (BUY). Keď sú body nad sviečkou — trh je v klesajúcom trende (SELL).

**Ako funguje:**
- Indikátor vypočítava pozíciu bodov pomocou akceleračného faktora (AF), ktorý sa začína na 0,02 a zvyšuje sa o 0,02 pri každom novom extrémnom bode (maximum/minimum), maximálne do 0,20.
- Keď cena prerazí úroveň SAR, dochádza k obratu — pozícia sa uzatvára a otvára sa opačná.
- Táto stratégia obchoduje každý signál obratu bez akýchkoľvek filtrov.

**Slabiny:** Veľa falošných signálov v bočnom (range) trhu, pretože nie je žiadny filter trendu.

---

## 2. SAR + SMA 200

Rozšírenie základnej stratégie o filter 200-periódového jednoduchého kĺzavého priemeru (SMA 200).

**Ako funguje:**
- BUY signály sa realizujú iba ak je cena NAD SMA 200 (rastúci trend).
- SELL signály sa realizujú iba ak je cena POD SMA 200 (klesajúci trend).
- SAR signály v opačnom smere voči SMA 200 sa ignorujú.

**Výhoda:** Eliminuje obchody proti hlavnému trendu. SMA 200 je štandardný indikátor pre určenie dlhodobého smeru trhu.

---

## 3. SAR + ADX

Rozšírenie SAR o filter sily trendu pomocou indikátora ADX (Average Directional Index).

**Ako funguje:**
- Obchod sa otvorí iba ak ADX > 25, čo znamená prítomnosť silného trendu.
- Okrem toho sa kontrolujú smerové indikátory DI+ a DI−:
  - BUY: DI+ > DI− (býčia sila prevláda).
  - SELL: DI− > DI+ (medvedia sila prevláda).
- Ak ADX ≤ 25 (slabý alebo bočný trh), signály SAR sa ignorujú.

**Výhoda:** Filtruje signály v bočných trhoch, kde SAR generuje najviac strát.

---

## 4. SAR Composite

Kombinovaná stratégia so systémom hodnotenia zhody (confluence scoring).

**Ako funguje:**
- Pre každý SAR signál sa vypočíta skóre na základe 4 filtrov:
  - **SMA 200** — cena na správnej strane kĺzavého priemeru (+1 bod)
  - **ADX > 25** + správny DI smer (+1 bod)
  - **MACD** — histogram v správnom smere (+1 bod)
  - **RSI** — nie je v extrémnej zóne, t.j. nie prekúpený/prepredaný (+1 bod)
- Obchod sa otvorí iba ak skóre ≥ 2 zo 4 (minimálna zhoda).
- Stop-loss sa nastavuje dynamicky na 2,5× ATR (Average True Range) od vstupnej ceny a priebežne sa posúva v smere obchodu (trailing stop).

**Výhoda:** Viacnásobné potvrdenie signálu výrazne znižuje počet falošných vstupov. Dynamický stop-loss chráni zisk.

---

## 5. Adaptive Hybrid

Najkomplexnejšia stratégia s automatickým prepínaním režimov podľa trhových podmienok.

**Ako funguje:**
- Stratégia rozlišuje dva režimy trhu na základe ADX:
  - **Trendový režim (ADX ≥ 25):** Používa kríženie EMA 20/50. Keď rýchly EMA prerazí pomalý nahor a DI+ > DI− — BUY. Keď prerazí nadol a DI− > DI+ — SELL. Stop-loss = 2,0× ATR s trailingom.
  - **Režim návratu k priemeru (ADX ≤ 20):** Používa extrémne hodnoty RSI. RSI ≤ 30 (prepredaný) — BUY. RSI ≥ 70 (prekúpený) — SELL. Stop-loss = 1,5× ATR. Pozícia sa uzatvára keď sa RSI vráti k stredným hodnotám (45–55).
- **Šedá zóna (ADX 20–25):** Žiadne nové obchody sa neotvárajú.
- Do kalkulácie zisku/straty sa odpočítava spread 1,5 pipu, čo simuluje reálne obchodné podmienky.

**Výhoda:** Prispôsobuje sa aktuálnemu stavu trhu namiesto použitia jednej stratégie na všetky situácie. Spread modeling zvyšuje reálnosť výsledkov.

---

# Торговые стратегии — FX Analytics

## 1. Parabolic SAR (базовая стратегия)

Parabolic SAR (Stop and Reverse) — трендовый индикатор, отображающий точки над или под ценой.
Когда точки под свечой — рынок в восходящем тренде (BUY). Когда точки над свечой — рынок в нисходящем тренде (SELL).

**Как работает:**
- Индикатор вычисляет позицию точек с помощью фактора ускорения (AF), который начинается с 0,02 и увеличивается на 0,02 при каждом новом экстремуме (максимум/минимум), максимум до 0,20.
- Когда цена пробивает уровень SAR, происходит разворот — позиция закрывается и открывается противоположная.
- Эта стратегия торгует каждый сигнал разворота без каких-либо фильтров.

**Слабости:** Много ложных сигналов в боковом (range) рынке, так как отсутствует фильтр тренда.

---

## 2. SAR + SMA 200

Расширение базовой стратегии фильтром 200-периодной простой скользящей средней (SMA 200).

**Как работает:**
- BUY сигналы исполняются только когда цена ВЫШЕ SMA 200 (восходящий тренд).
- SELL сигналы исполняются только когда цена НИЖЕ SMA 200 (нисходящий тренд).
- Сигналы SAR в противоположном направлении от SMA 200 игнорируются.

**Преимущество:** Устраняет сделки против основного тренда. SMA 200 — стандартный индикатор для определения долгосрочного направления рынка.

---

## 3. SAR + ADX

Расширение SAR фильтром силы тренда через индикатор ADX (Average Directional Index).

**Как работает:**
- Сделка открывается только при ADX > 25, что означает наличие сильного тренда.
- Дополнительно проверяются направленные индикаторы DI+ и DI−:
  - BUY: DI+ > DI− (преобладает бычья сила).
  - SELL: DI− > DI+ (преобладает медвежья сила).
- При ADX ≤ 25 (слабый или боковой рынок) сигналы SAR игнорируются.

**Преимущество:** Фильтрует сигналы в боковых рынках, где SAR генерирует наибольшие убытки.

---

## 4. SAR Composite

Комбинированная стратегия с системой оценки совпадения сигналов (confluence scoring).

**Как работает:**
- Для каждого сигнала SAR рассчитывается оценка на основе 4 фильтров:
  - **SMA 200** — цена на правильной стороне скользящей средней (+1 балл)
  - **ADX > 25** + правильное направление DI (+1 балл)
  - **MACD** — гистограмма в правильном направлении (+1 балл)
  - **RSI** — не в экстремальной зоне, т.е. не перекуплен/перепродан (+1 балл)
- Сделка открывается только если оценка ≥ 2 из 4 (минимальное совпадение).
- Стоп-лосс устанавливается динамически на 2,5× ATR (Average True Range) от цены входа и подтягивается в направлении сделки (trailing stop).

**Преимущество:** Многократное подтверждение сигнала значительно снижает количество ложных входов. Динамический стоп-лосс защищает прибыль.

---

## 5. Adaptive Hybrid

Самая сложная стратегия с автоматическим переключением режимов в зависимости от рыночных условий.

**Как работает:**
- Стратегия различает два режима рынка на основе ADX:
  - **Трендовый режим (ADX ≥ 25):** Используется пересечение EMA 20/50. Когда быстрая EMA пересекает медленную вверх и DI+ > DI− — BUY. Когда пересекает вниз и DI− > DI+ — SELL. Стоп-лосс = 2,0× ATR с трейлингом.
  - **Режим возврата к среднему (ADX ≤ 20):** Используются экстремальные значения RSI. RSI ≤ 30 (перепродан) — BUY. RSI ≥ 70 (перекуплен) — SELL. Стоп-лосс = 1,5× ATR. Позиция закрывается когда RSI возвращается к средним значениям (45–55).
- **Серая зона (ADX 20–25):** Новые сделки не открываются.
- В расчёт прибыли/убытка вычитается спред 1,5 пипса, что моделирует реальные торговые условия.

**Преимущество:** Адаптируется к текущему состоянию рынка вместо применения одной стратегии ко всем ситуациям. Моделирование спреда повышает реалистичность результатов.

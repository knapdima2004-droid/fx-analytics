"""Automated statistical interpretation of backtest and forecast results.

Uses OpenAI API to generate thorough, academic-grade analysis for
inclusion in the thesis report. Falls back to rule-based interpretation
when API key is not configured.

NOTE: No branding or attribution to any specific AI tool should appear
in the generated text. The analysis is presented as part of the system.
"""

from __future__ import annotations

import json
from typing import Any

from app.core.config import settings
from app.core.logging_config import get_logger

log = get_logger(__name__)


async def analyze_results(
    pair: str,
    timeframe: str,
    start: str,
    end: str,
    backtest_results: list[dict[str, Any]] | None = None,
    statistical_tests: dict[str, Any] | None = None,
    data_summary: dict[str, Any] | None = None,
    forecast_data: list[dict[str, Any]] | None = None,
    language: str = "en",
) -> dict[str, str]:
    """Generate a thorough statistical interpretation of FX analysis results.

    Returns dict with sections:
      - summary: Overall analysis summary
      - model_comparison: Detailed model comparison
      - test_interpretation: Scientific interpretation of statistical tests
      - recommendation: Practical recommendation
      - conclusion: Thesis-suitable conclusion paragraph
    """
    if not settings.OPENAI_API_KEY:
        return _fallback_analysis(backtest_results, statistical_tests, language)

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        system_prompt = _build_system_prompt(language)
        user_prompt = _build_user_prompt(
            pair, timeframe, start, end,
            backtest_results, statistical_tests,
            data_summary, forecast_data,
        )

        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.25,
            max_tokens=2500,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        log.info("analysis.success", pair=pair)

        return {
            "summary": _to_text(result.get("summary", "")),
            "model_comparison": _to_text(result.get("model_comparison", "")),
            "test_interpretation": _to_text(result.get("test_interpretation", "")),
            "recommendation": _to_text(result.get("recommendation", "")),
            "conclusion": _to_text(result.get("conclusion", "")),
        }

    except Exception as e:
        log.error("analysis.failed", error=str(e))
        return _fallback_analysis(backtest_results, statistical_tests, language)


def _to_text(val) -> str:
    """Convert a value to readable text – handles nested dict/list from API."""
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        parts = []
        for k, v in val.items():
            if isinstance(v, dict):
                sub = "; ".join(f"{sk}: {sv}" for sk, sv in v.items())
                parts.append(f"{k}: {sub}")
            elif isinstance(v, list):
                items = ", ".join(str(x) for x in v)
                parts.append(f"{k}: {items}")
            else:
                parts.append(f"{k}: {v}")
        return " ".join(parts)
    if isinstance(val, list):
        return " ".join(str(x) for x in val)
    return str(val) if val else ""


def _build_system_prompt(language: str) -> str:
    lang_map = {
        "sk": "Respond ENTIRELY in Slovak (Slovenčina). Use formal academic Slovak.",
        "cs": "Respond ENTIRELY in Czech language. Use formal academic Czech.",
        "en": "Respond in formal academic English.",
    }
    lang_instruction = lang_map.get(language, lang_map["en"])

    return f"""You are a senior quantitative finance analyst and academic reviewer with 15+ years
of experience in foreign exchange markets, econometrics, and statistical time-series forecasting.

{lang_instruction}

TASK: Produce a thorough, scientifically rigorous, and highly detailed interpretation of
walk-forward backtest results and statistical tests for currency pair forecasting models.
This text will be directly included in a bachelor's thesis chapter on statistical processing
and evaluation of currency pair data. The quality must be publication-ready.

CRITICAL REQUIREMENTS:
1. Be analytically precise. Every sentence must carry substantive content.
2. Use formal academic language: "the results indicate", "it can be observed that",
   "the empirical evidence suggests", "the analysis reveals".
3. Explain the PRACTICAL and ECONOMIC significance of each metric:
   - For MAE/RMSE: convert to pips where possible (1 pip = 0.0001 for EUR/USD, 0.01 for JPY pairs)
   - For directional accuracy: ALWAYS compare to the 50% random baseline AND to the Naive model's DA
   - Discuss what the error magnitude means for real trading decisions
4. Model mathematical properties (use when explaining performance differences):
   - ARIMA: parametric, captures linear autocorrelation
   - Ridge: regularized linear regression, relies on feature engineering
   - RandomForest: non-parametric, captures non-linear patterns
   - AIEnsemble: meta-model that combines base model predictions with technical indicators
   - Naive/MA: baselines, no learning
5. For directional accuracy below 50%, explicitly state this is WORSE than random guessing.
   For DA between 50% and 53%, state this is STATISTICALLY INDISTINGUISHABLE from random.
   Only DA above ~55% starts showing meaningful predictive ability.
6. NEVER mention any AI system, chatbot, language model, or automated tool.
   Write as a human analyst authoring a thesis chapter.
   For AIEnsemble, describe it as "ensemble meta-model" or "combined model".
7. NEVER use phrases like "generated by AI", "AI-powered", "ChatGPT", "GPT", "LLM", or similar.
8. LOGICAL CONSISTENCY IS MANDATORY — this is the most important rule:
   a) NEVER contradict yourself. If you say model X outperforms Naive, do NOT later
      say it fails to outperform it. Check the numbers ONCE, decide, and be consistent.
   b) When comparing models, use BOTH metrics (RMSE and DA). A model with lowest RMSE
      but DA below Naive is NOT "the best model" — it is "best at minimizing error magnitude
      but worse at predicting direction".
   c) If all models have DA between 48%-53%, explicitly state that NO model demonstrates
      statistically significant directional forecasting ability.
9. BEST MODEL SELECTION — follow this exact algorithm:
   a) Find the Naive model's DA (this is the baseline to beat).
   b) A model is "genuinely better" ONLY if it has BOTH lower RMSE than Naive AND higher DA than Naive.
   c) If a model has lower RMSE but LOWER DA than Naive, it is ONLY better at error minimization,
      NOT at directional forecasting. State this honestly.
   d) If the Diebold-Mariano test p-value > 0.05, the difference is NOT statistically significant.
      State this explicitly and do NOT claim one model is "significantly better" than another.
   e) DA of ~50% means the model is no better than a coin flip. DO NOT describe 50-51% DA as
      "acceptable" or "adequate". It is essentially random.
10. When p-value is very small (e.g. 0.0), write "< 0.001" rather than "0.0".
    A p-value of exactly 0.0 is a rounding artifact, not a true value.
11. Use correct grammar in the target language. For Slovak: match gender of adjectives
    with nouns ("zvyšková autokorelácia", not "zvyškový autokorelácia").
12. For Ljung-Box, if p < 0.05, state as a fact that autocorrelation was detected.
    Do NOT use hypothetical "if there were autocorrelation" phrasing when the test
    already confirms it.

IMPORTANT STYLE RULE: The report already contains tables and cards with all exact numbers
(MAE, RMSE, directional accuracy for each model; test statistics and p-values).
DO NOT repeat every number in your text — the reader can see them in the tables.
Instead, focus on ANALYSIS, INSIGHTS, and INTERPRETATION that the tables cannot convey.
Mention key numbers only when making a comparative point or drawing a conclusion.
Keep each section CONCISE — quality over quantity. Avoid filler and repetition.

OUTPUT FORMAT: Return a JSON object with exactly these 5 keys.
Each value MUST be a plain text string (NOT a nested object or array).

- "summary": Concise overview (4-5 sentences). Cover:
  * The currency pair, time period, sample size
  * Which models were evaluated (just list names, no need for full descriptions)
  * The key finding: which model performed best and the magnitude of improvement over baseline
  * One-sentence overall assessment of predictability

- "model_comparison": Focused analytical comparison (5-7 sentences). DO NOT list each model
  with its full metrics — the table already shows that. Instead:
  * Group models into tiers (e.g., "best performer", "comparable to baseline", "underperformers")
  * Highlight the most interesting comparisons (best vs baseline, AI vs traditional)
  * Explain WHY certain models outperform or underperform (mathematical properties, market efficiency)
  * One sentence on economic significance of the best model's improvement

- "test_interpretation": Brief test analysis (4-6 sentences). DO NOT restate all test
  statistics and p-values — they are displayed in the cards above. Instead:
  * For each test, state the conclusion and its practical implication in 1-2 sentences
  * Synthesize: what do all tests together tell us about the forecasting approach?

- "recommendation": Practical advice (3-4 sentences). Cover:
  * Which model to use and why (one sentence)
  * Key limitations and when the model may fail (one sentence)
  * Most important improvement suggestion (one sentence)

- "conclusion": Formal academic conclusion (5-7 sentences) suitable for a thesis chapter. Cover:
  * Restate the research objective
  * Key quantitative findings (best model, its RMSE and DA — these are worth repeating here)
  * Scientific verdict: is the method suitable?
  * Limitations and future research direction
  * Use formal academic phrasing: "On the basis of the conducted analysis...",
    "The empirical results demonstrate...", "It can be concluded that..." """


def _build_user_prompt(
    pair: str,
    timeframe: str,
    start: str,
    end: str,
    backtest_results: list[dict[str, Any]] | None,
    statistical_tests: dict[str, Any] | None,
    data_summary: dict[str, Any] | None,
    forecast_data: list[dict[str, Any]] | None,
) -> str:
    parts = [
        f"Currency pair: {pair}",
        f"Timeframe: {timeframe}",
        f"Analysis period: {start} to {end}",
    ]

    if data_summary:
        parts.append(f"\n## Data Summary\n{json.dumps(data_summary, indent=2)}")

    if backtest_results:
        parts.append(f"\n## Backtest Results (Walk-Forward Cross-Validation)\n{json.dumps(backtest_results, indent=2)}")

    if statistical_tests:
        parts.append(f"\n## Statistical Tests\n{json.dumps(statistical_tests, indent=2)}")

    if forecast_data:
        parts.append(f"\n## Recent Forecast Points (sample)\n{json.dumps(forecast_data[:5], indent=2)}")

    # Add explicit Naive baseline context
    naive_da = None
    best_rmse_model = None
    da_rmse_conflict = False
    if data_summary:
        naive_da = data_summary.get("naive_da")
        best_rmse_model = data_summary.get("best_rmse_model")
        da_rmse_conflict = data_summary.get("da_rmse_conflict", False)

    baseline_context = ""
    if naive_da is not None:
        baseline_context = f"\n\nBASELINE CONTEXT (use this for honest comparison):"
        baseline_context += f"\n- Naive model directional accuracy: {naive_da}%"
        baseline_context += f"\n- Random baseline: 50%"
        if best_rmse_model and da_rmse_conflict:
            best_rmse_da = data_summary.get("best_rmse_da", "?")
            best_da_model = data_summary.get("best_da_model", "?")
            best_da_value = data_summary.get("best_da_value", "?")
            baseline_context += (
                f"\n- CONFLICT: {best_rmse_model} has the lowest RMSE but its DA ({best_rmse_da}%) "
                f"is LOWER than {best_da_model} ({best_da_value}%). "
                f"You MUST acknowledge this conflict honestly in your analysis."
            )

    parts.append(
        f"{baseline_context}"
        "\n\nProvide a concise, insightful analysis. Focus on INTERPRETATION and INSIGHTS, "
        "not repeating raw numbers from the tables (the reader already sees them)."
        "\n\nIMPORTANT RULES:"
        "\n- A model is genuinely better than Naive ONLY if it has BOTH lower RMSE AND higher DA than Naive."
        "\n- If a model has lower RMSE but LOWER DA than Naive, state clearly that it only minimizes "
        "error magnitude but fails to predict direction better than the simplest baseline."
        "\n- DA between 48-53% is STATISTICALLY INDISTINGUISHABLE from random. Never call this 'acceptable' or 'adequate'."
        "\n- If the DM test p-value > 0.05, do NOT claim any model is 'significantly' better than another."
        "\n- For p-values close to 0, write '< 0.001' rather than '0.0'."
        "\n- Do NOT contradict yourself."
        "\n- Use 'pValue_display' values from statistical tests for presentation."
        "\n- KEEP IT SHORT. The model_comparison and test_interpretation sections should be "
        "3-7 sentences each, NOT a wall of text repeating every single metric."
    )

    return "\n".join(parts)


def _fallback_analysis(
    backtest_results: list[dict[str, Any]] | None,
    statistical_tests: dict[str, Any] | None,
    language: str = "en",
) -> dict[str, str]:
    """Generate a rule-based analysis when OpenAI API is unavailable."""
    is_sk = language == "sk"

    # Analyze backtest results
    models_info = []
    best_model = None
    best_mae = float("inf")

    if backtest_results:
        for r in backtest_results:
            model = r.get("model", "Unknown")
            metrics = r.get("metrics", r)
            mae = metrics.get("mae", 0)
            rmse = metrics.get("rmse", 0)
            da = metrics.get("directionalAccuracy", 0)
            models_info.append({"model": model, "mae": mae, "rmse": rmse, "da": da})
            if mae < best_mae:
                best_mae = mae
                best_model = model

    # Build summary
    n_models = len(models_info)
    if is_sk:
        summary = (
            f"Walk-forward backtestom bolo vyhodnotených {n_models} predikčných modelov. "
            + (f"Model s najnižšou MAE je {best_model} (MAE = {best_mae:.6f}). " if best_model else "")
            + "Podrobné výsledky sú uvedené nižšie."
        )
    else:
        summary = (
            f"Walk-forward backtest evaluated {n_models} forecasting models. "
            + (f"The model with the lowest MAE is {best_model} (MAE = {best_mae:.6f}). " if best_model else "")
            + "Detailed results are provided below."
        )

    # Model comparison
    comparison_parts = []
    for m in models_info:
        if is_sk:
            comparison_parts.append(
                f"{m['model']}: MAE = {m['mae']:.6f}, RMSE = {m['rmse']:.6f}, "
                f"smerová presnosť = {m['da']:.2%}"
            )
        else:
            comparison_parts.append(
                f"{m['model']}: MAE = {m['mae']:.6f}, RMSE = {m['rmse']:.6f}, "
                f"directional accuracy = {m['da']:.2%}"
            )
    model_comparison = ". ".join(comparison_parts) + "." if comparison_parts else (
        "Žiadne výsledky backtestu nie sú k dispozícii." if is_sk else "No backtest results available."
    )

    # Test interpretation
    test_parts = []
    if statistical_tests:
        adf = statistical_tests.get("adf", {})
        if adf:
            stationary = adf.get("pValue", 1) < 0.05
            if is_sk:
                test_parts.append(
                    f"ADF test: p-hodnota = {adf.get('pValue', 'N/A'):.6f}, "
                    f"rad je {'stacionárny' if stationary else 'nestacionárny'}."
                )
            else:
                test_parts.append(
                    f"ADF test: p-value = {adf.get('pValue', 'N/A'):.6f}, "
                    f"the series is {'stationary' if stationary else 'non-stationary'}."
                )
        lb = statistical_tests.get("ljungBox", {})
        if lb:
            autocorr = lb.get("pValue", 1) < 0.05
            if is_sk:
                test_parts.append(
                    f"Ljung-Box test: p-hodnota = {lb.get('pValue', 'N/A'):.6f}, "
                    f"{'zistená významná autokorelácia' if autocorr else 'bez významnej autokorelácie'}."
                )
            else:
                test_parts.append(
                    f"Ljung-Box test: p-value = {lb.get('pValue', 'N/A'):.6f}, "
                    f"{'significant autocorrelation detected' if autocorr else 'no significant autocorrelation'}."
                )
    test_interpretation = " ".join(test_parts) if test_parts else (
        "Žiadne štatistické testy nie sú k dispozícii." if is_sk else "No statistical tests available."
    )

    if is_sk:
        recommendation = (
            f"Na základe MAE sa odporúča model {best_model}." if best_model else
            "Najprv spustite backtest."
        )
        conclusion = (
            "Analýza bola vygenerovaná bez rozšírenej interpretácie. "
            "Pre podrobnejšiu analýzu nakonfigurujte kľúč API."
        )
    else:
        recommendation = (
            f"Based on MAE, the recommended model is {best_model}." if best_model else
            "Run a backtest first."
        )
        conclusion = (
            "Analysis generated with basic rule-based interpretation. "
            "Configure the API key for detailed scientific analysis."
        )

    return {
        "summary": summary,
        "model_comparison": model_comparison,
        "test_interpretation": test_interpretation,
        "recommendation": recommendation,
        "conclusion": conclusion,
    }

import pandas as pd
from scipy.stats import mannwhitneyu

# Load data
multi = pd.read_csv("UI experiment(multi-agent).csv")
single = pd.read_csv("UI experiment(single-llm).csv")

# Models to compare
models = ["Claude Opus 4.6", "Deepseek v3.2", "GPT-5.2", "Gemini 3 Pro"]

# Cliff's delta
def cliffs_delta(x, y):
    nx, ny = len(x), len(y)
    greater = sum(1 for xi in x for yi in y if xi > yi)
    less = sum(1 for xi in x for yi in y if xi < yi)
    return (greater - less) / (nx * ny)

# Effect size interpretation
def interpret_cliffs_delta(delta):
    ad = abs(delta)
    if ad < 0.147:
        return "negligible"
    elif ad < 0.33:
        return "small"
    elif ad < 0.474:
        return "medium"
    else:
        return "large"

results = []

for model in models:
    x = multi[model].dropna().values   # multi-agent
    y = single[model].dropna().values  # single-llm

    # Mann–Whitney U test
    u_stat, p_value = mannwhitneyu(x, y, alternative="two-sided")

    # Cliff's delta
    delta = cliffs_delta(x, y)
    effect = interpret_cliffs_delta(delta)

    results.append({
        "Model": model,
        "Single LLM Mean": round(y.mean(), 4),
        "Multi-agent Mean": round(x.mean(), 4),
        "U statistic": round(u_stat, 4),
        "p-value": round(p_value, 4),
        "Cliff's delta": round(delta, 4),
        "Effect size": effect
    })

# Final table
results_df = pd.DataFrame(results)
print(results_df)
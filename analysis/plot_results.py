"""Render the thesis's paired-stage mean-score chart from aggregate JSON."""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
import numpy as np


def select_font(path):
    if path is not None:
        font_manager.fontManager.addfont(str(path))
        return font_manager.FontProperties(fname=str(path)).get_name()
    installed = {font.name for font in font_manager.fontManager.ttflist}
    for family in ("Yu Mincho", "Noto Sans CJK JP", "Noto Sans JP", "IPAexGothic"):
        if family in installed:
            return family
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("summary", type=Path, help="audit_results.json from audit.py")
    parser.add_argument("--output", type=Path, required=True, help="destination image")
    parser.add_argument("--font", type=Path, help="optional local Japanese font file")
    parser.add_argument("--language", choices=("ja", "en"), default="ja")
    args = parser.parse_args()

    d = json.loads(args.summary.read_text(encoding="utf-8"))
    ja = args.language == "ja"
    plt.rcParams.update({
        "font.size": 10,
        "axes.unicode_minus": False,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })
    family = select_font(args.font)
    if ja and family is None:
        parser.error("A Japanese font is required for --language ja; use --font or --language en.")
    if family is not None:
        plt.rcParams["font.family"] = family

    fig, ax = plt.subplots(figsize=(5.75, 3.45), layout="constrained")
    x = np.arange(3)
    for offset, key, label, color in (
        (-0.18, "pre", "事前7問" if ja else "Pre (7 items)", "#C8C8C8"),
        (0.18, "post", "事後対応7問" if ja else "Post (7 matching items)", "#454545"),
    ):
        values = np.array([d["descriptive"][g][key]["mean"] * 100 for g in "ABC"])
        intervals = np.array([d["descriptive"][g][key]["ci95_mean_unadjusted"] for g in "ABC"]) * 100
        err = np.vstack([values - intervals[:, 0], intervals[:, 1] - values])
        ax.bar(x + offset, values, width=.31, label=label, color=color,
               edgecolor="black", linewidth=.5, zorder=3)
        ax.errorbar(x + offset, values, yerr=err, fmt="none", ecolor="black",
                    elinewidth=.8, capsize=3, zorder=4)
        for xx, yy, hi in zip(x + offset, values, intervals[:, 1]):
            ax.text(xx, hi + 1.3, f"{yy:.1f}", ha="center", va="bottom", fontsize=9)

    ax.set_xticks(x, ["A群\n文章", "B群\n画像", "C群\n画像＋追加解説"] if ja
                  else ["A\nText", "B\nImages", "C\nImages + explanations"])
    ax.set_ylabel("平均正答率（%）" if ja else "Mean correct answers (%)")
    ax.set_ylim(0, 103)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.grid(axis="y", color="#DEDEDE", linewidth=.55, zorder=0)
    ax.legend(frameon=False, loc="upper left", ncol=2, fontsize=9)
    ax.tick_params(axis="both", length=3)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, dpi=300)
    plt.close(fig)


if __name__ == "__main__":
    main()

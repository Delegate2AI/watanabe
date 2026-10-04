import { describe, expect, it } from "vitest";
import { formatTranscript, parseUtterances } from "./transcript-format";

describe("parseUtterances", () => {
  it("merges consecutive segments from the same speaker", () => {
    const text = [
      "Edgar: So this is it.",
      "Edgar: They lost their primary uplink.",
      "Rodion: Is it in their SLA?",
    ].join("\n");
    expect(parseUtterances(text)).toEqual([
      { speaker: "Edgar", text: "So this is it. They lost their primary uplink." },
      { speaker: "Rodion", text: "Is it in their SLA?" },
    ]);
  });

  it("treats a line with no speaker label as a continuation", () => {
    const text = "Edgar: So this is it.\nand the table rebalanced";
    expect(parseUtterances(text)).toEqual([
      { speaker: "Edgar", text: "So this is it. and the table rebalanced" },
    ]);
  });

  it("does not split a sentence that happens to contain a colon", () => {
    const text = "Edgar: The cause was clear.\nOne thing is certain: BGP reconverged.";
    expect(parseUtterances(text)).toEqual([
      { speaker: "Edgar", text: "The cause was clear. One thing is certain: BGP reconverged." },
    ]);
  });

  it("labels an unattributed opening line", () => {
    expect(parseUtterances("no speaker here at all")).toEqual([
      { speaker: "Unknown", text: "no speaker here at all" },
    ]);
  });

  it("drops segments with no words", () => {
    expect(parseUtterances("Edgar:\nRodion: Yes.")).toEqual([{ speaker: "Rodion", text: "Yes." }]);
  });
});

describe("formatTranscript", () => {
  it("renders one bolded paragraph per utterance", () => {
    const text = "Edgar: So this is it.\nRodion: Is it in their SLA?";
    expect(formatTranscript(text)).toBe("**Edgar:** So this is it.\n\n**Rodion:** Is it in their SLA?");
  });

  it("returns the original text when there is nothing to format", () => {
    expect(formatTranscript("   ")).toBe("");
  });
});

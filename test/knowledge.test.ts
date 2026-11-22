import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedOfficialUrl, searchOfficialDocs } from "../src/knowledge/liveLookup.js";
import {
  clearPdfCache,
  getPdfDocument,
  listPdfDocuments,
  searchPdfDocuments
} from "../src/knowledge/pdfDocs.js";
import { searchCuratedDocs } from "../src/knowledge/search.js";
import { buildWritingGuidance, getCodesysTopic } from "../src/knowledge/topics.js";
import { createSimplePdf } from "./pdf-fixture.js";
import { makeTestConfig } from "./helpers.js";

const testConfig = makeTestConfig();

describe("CODESYS knowledge search", () => {
  it("returns curated results for Structured Text timer queries", () => {
    const results = searchCuratedDocs("Structured Text TON timer");
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((result) => result.id)).toContain("timers");
  });

  it("surfaces the official CODESYS examples source", () => {
    const results = searchCuratedDocs("official CODESYS examples sample projects", 3);
    expect(results[0]?.id).toBe("official-codesys-help-and-examples");
  });

  it("returns topic details with citations and examples", async () => {
    const result = await getCodesysTopic("function block", "normal", true, testConfig);
    expect(result.topic.toLowerCase()).toContain("function block");
    expect(result.answer).toContain("function block");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.examples?.length).toBeGreaterThan(0);
  });

  it("builds safety-aware writing guidance", () => {
    const guidance = buildWritingGuidance({
      task: "Write a motor control function block with EtherCAT drive feedback",
      target: "function_block",
      constraints: "Use IEC 61131-3 Structured Text"
    });
    expect(guidance.topic).toBe("CODESYS Writing Guidance");
    expect(guidance.answer).toContain("Safety note");
  });

  it("rejects non-allowlisted official lookup URLs", () => {
    expect(isAllowedOfficialUrl("https://content.helpme-codesys.com/en/test.html")).toBe(true);
    expect(isAllowedOfficialUrl("https://example.com/not-codesys")).toBe(false);
    expect(isAllowedOfficialUrl("http://content.helpme-codesys.com/insecure")).toBe(false);
  });

  it("returns no official results when live lookup is disabled", async () => {
    await expect(searchOfficialDocs("TON timer", 3, testConfig)).resolves.toEqual([]);
  });

  it("lists, searches, and returns extracted PDF text", async () => {
    const pdfDir = await mkdtemp(path.join(tmpdir(), "codesys-pdfs-"));
    const pdfPath = path.join(pdfDir, "codesys-local-manual.pdf");
    const config = { ...testConfig, pdfSearchEnabled: true, pdfDocsDir: pdfDir };
    try {
      await writeFile(
        pdfPath,
        await createSimplePdf("CODESYS local PDF manual covers TON timers and task watchdogs.")
      );
      clearPdfCache();
      const pdfs = await listPdfDocuments(config);
      expect(pdfs).toHaveLength(1);
      const results = await searchPdfDocuments("task watchdog", 3, config);
      expect(results[0]?.sourceType).toBe("pdf");
      const pdf = await getPdfDocument("codesys-local-manual.pdf", 12000, config);
      expect(pdf?.text).toContain("TON timers");
    } finally {
      clearPdfCache();
      await rm(pdfDir, { recursive: true, force: true });
    }
  });

  it("skips PDFs above the configured byte limit", async () => {
    const pdfDir = await mkdtemp(path.join(tmpdir(), "codesys-pdfs-limit-"));
    try {
      await writeFile(path.join(pdfDir, "large.pdf"), "not empty", "utf8");
      clearPdfCache();
      const config = {
        ...testConfig,
        pdfSearchEnabled: true,
        pdfDocsDir: pdfDir,
        pdfMaxFileBytes: 1
      };
      expect(await listPdfDocuments(config)).toEqual([]);
    } finally {
      clearPdfCache();
      await rm(pdfDir, { recursive: true, force: true });
    }
  });
});

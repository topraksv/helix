import { describe, expect, it } from "vitest";
import { csvCell } from "../src/services/backup-validation";

/**
 * The CSV export is opened in Excel/Sheets AND can be fed back through the
 * import wizard (it accepts `text/csv`), so every user-entered cell is both an
 * untrusted boundary and data that must survive intact.
 */

/** Minimal RFC 4180 reader, used to prove the export is really parseable. */
function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') cell += character;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") cell += character;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

describe("CSV export cell safety", () => {
  it("neutralizes a formula in the first character", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1")).toBe("'-1");
  });

  it("neutralizes a formula hidden behind leading whitespace or a carriage return", () => {
    for (const payload of [" =1+1", "\t=1+1", "   @SUM(A1)", " =1+1"]) {
      expect(csvCell(payload).startsWith("'"), payload).toBe(true);
    }
    // A CR also has to be quoted, so the apostrophe sits inside the quotes.
    expect(csvCell("\r=cmd|'/C calc'!A0")).toBe(`"'\r=cmd|'/C calc'!A0"`);
  });

  it("quotes structural characters instead of deleting them", () => {
    expect(csvCell("Yemek; İçecek")).toBe('"Yemek; İçecek"');
    expect(csvCell('Fatura "acil"')).toBe('"Fatura ""acil"""');
    expect(csvCell("satır1\nsatır2")).toBe('"satır1\nsatır2"');
  });

  it("leaves ordinary Turkish text untouched", () => {
    expect(csvCell("Market alışverişi")).toBe("Market alışverişi");
    expect(csvCell("Öğle yemeği (İş)")).toBe("Öğle yemeği (İş)");
    expect(csvCell("1.234,56 TL ödendi")).toBe("1.234,56 TL ödendi");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("round-trips every hostile and legitimate value through a real CSV parse", () => {
    const originals = [
      "Yemek; İçecek",
      'Fatura "acil"',
      "satır1\nsatır2",
      "satır1\r\nsatır2",
      "Öğle yemeği (İş)",
      "",
      "  boşlukla başlıyor",
      "=1+1",
      " =1+1",
      "-500 iade",
      "@herkes",
      "sekme\tarası",
    ];
    const line = originals.map(csvCell).join(";");
    const [parsed] = parseCsv(line);
    expect(parsed).toHaveLength(originals.length);
    for (const [index, original] of originals.entries()) {
      const cell = parsed![index]!;
      // A neutralized formula keeps its full original text behind the marker;
      // everything else comes back byte-identical, CRLF included.
      const restored = cell.startsWith("'") ? cell.slice(1) : cell;
      expect(restored, original).toBe(original);
    }
  });

  it("never lets one cell forge an extra column or row", () => {
    const forged = csvCell("kolon1;kolon2\nsahte satır");
    const rows = parseCsv(["a", forged, "b"].join(";"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
  });

  it("forges nothing from a delimiter alone, with no newline to fall back on", () => {
    // The payload above carries a newline, so dropping `;` from the quoting set
    // still produced a quoted cell and this contract stayed green. A note that
    // contains only a semicolon is the pure column-forging vector.
    const rows = parseCsv(["a", csvCell("kolon1;kolon2"), "b"].join(";"));
    expect(rows[0]).toHaveLength(3);
    expect(rows[0]?.[1]).toBe("kolon1;kolon2");

    // Likewise a lone CR or LF must not forge a row without a delimiter present.
    for (const payload of ["satır1\nsatır2", "satır1\rsatır2"]) {
      const forgedRows = parseCsv(["a", csvCell(payload), "b"].join(";"));
      expect(forgedRows, payload).toHaveLength(1);
      expect(forgedRows[0], payload).toHaveLength(3);
    }
  });
});

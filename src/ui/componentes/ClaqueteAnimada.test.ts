import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClaqueteAnimada } from "./ClaqueteAnimada";
import styles from "./ClaqueteAnimada.module.css";

const PROPORCAO = 84 / 78;

describe("ClaqueteAnimada", () => {
  it("desenha o svg com a haste que bate, decorativo, na cor do texto e no degradê da marca", () => {
    const html = renderToStaticMarkup(createElement(ClaqueteAnimada));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`class="${styles.braco}"`);
    expect(html).toMatch(/stop-color:\s*var\(--luz-a\)/);
    expect(html).toMatch(/stop-color:\s*var\(--luz-b\)/);
    expect(html).toContain('fill="currentColor"');
  });

  it("a altura escolhe a largura pela proporção do símbolo", () => {
    const html = renderToStaticMarkup(createElement(ClaqueteAnimada, { altura: 48 }));
    expect(html).toContain('height="48"');
    expect(html).toContain(`width="${48 * PROPORCAO}"`);
  });

  it("respeita prefers-reduced-motion: a haste para, aberta (-17deg, a posição de descanso do símbolo estático)", () => {
    const css = readFileSync(join(__dirname, "ClaqueteAnimada.module.css"), "utf-8");
    const blocoReduzido = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(blocoReduzido).toContain(".braco");
    expect(blocoReduzido).toMatch(/animation:\s*none/);
    expect(blocoReduzido).toMatch(/rotate\(-17deg\)/);
  });
});

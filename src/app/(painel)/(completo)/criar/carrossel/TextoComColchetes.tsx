import { dividirPorColchetes } from "@/carrossel/colchetes";

import estilos from "./CarrosselTela.module.css";

/** O texto com os trechos entre colchetes destacados (o espaço para completar antes de postar). Sem colchete, é só o texto. */
export function TextoComColchetes({ texto }: { texto: string }) {
  return (
    <>
      {dividirPorColchetes(texto).map((p, i) =>
        p.colchete ? (
          <mark key={i} className={estilos.colchete}>
            {p.texto}
          </mark>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </>
  );
}

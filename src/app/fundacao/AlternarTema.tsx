"use client";

/**
 * So para esta pagina de conferencia: troca `data-tema` no `<html>` e grava
 * em localStorage (mesma chave que o script do layout raiz le antes da
 * pintura). A preferencia de tema por cliente em /conta e a parte 2.
 */
export function AlternarTema() {
  function trocar(tema: "claro" | "escuro" | null) {
    if (tema) {
      document.documentElement.setAttribute("data-tema", tema);
      localStorage.setItem("tema", tema);
    } else {
      document.documentElement.removeAttribute("data-tema");
      localStorage.removeItem("tema");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={() => trocar("claro")}>
        claro
      </button>
      <button type="button" onClick={() => trocar("escuro")}>
        escuro
      </button>
      <button type="button" onClick={() => trocar(null)}>
        do sistema
      </button>
    </div>
  );
}

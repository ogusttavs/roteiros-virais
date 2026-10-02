"use client";

import { Check, ChevronDown } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";

import { useMenuSuspenso } from "@/ui/componentes/useMenuSuspenso";

import styles from "./PilulaFiltro.module.css";

/** Os itens (`ItemMenuRadio`/`ItemMenuCheckbox`) pegam o `fechar` de cima do contexto, em vez de
 * cada chamador de `PilulaFiltro` ter que repassar a mesma função para cada item à mão. */
const ContextoFechar = createContext<() => void>(() => {});
function useFecharPilula(): () => void {
  return useContext(ContextoFechar);
}

type Props = {
  id: string;
  rotulo: string;
  ativa: boolean;
  menuRotulo: string;
  pilulaAberta: string | null;
  onAbrir: (id: string) => void;
  onFechar: () => void;
  children: ReactNode;
};

/**
 * A pílula de um filtro (passo 14, `.pilula-filtro`/`.menu-filtro`): o gatilho mostra o rótulo e
 * o estado (ativa quando o filtro tem um valor fora do padrão) e abre um menu suspenso genérico
 * (`useMenuSuspenso`, `src/ui/componentes/`). `pilulaAberta` vem de cima (`ReferenciasTela`), uma
 * string só para todas as pílulas, inclusive a de "Ordem" que mora em outro lugar da tela: só uma
 * pode estar aberta por vez, e abrir uma fecha a outra sozinha.
 */
export function PilulaFiltro({ id, rotulo, ativa, menuRotulo, pilulaAberta, onAbrir, onFechar, children }: Props) {
  const aberto = pilulaAberta === id;
  const { gatilhoRef, menuRef, fechar } = useMenuSuspenso(aberto, onFechar);

  return (
    <span className={styles.comMenu}>
      <button
        ref={gatilhoRef}
        type="button"
        className={[styles.pilula, ativa ? styles.ativa : ""].filter(Boolean).join(" ")}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => (aberto ? onFechar() : onAbrir(id))}
      >
        {rotulo}
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {aberto ? (
        <div ref={menuRef} role="menu" aria-label={menuRotulo} className={styles.menu}>
          <ContextoFechar.Provider value={fechar}>{children}</ContextoFechar.Provider>
        </div>
      ) : null}
    </span>
  );
}

type PropsItem = {
  rotulo: string;
  marcado: boolean;
  quantos?: number;
  onClick: () => void;
};

function ItemMenu({
  rotulo,
  marcado,
  quantos,
  onClick,
  fechaAoEscolher,
  role,
}: PropsItem & { fechaAoEscolher: boolean; role: "menuitemradio" | "menuitemcheckbox" }) {
  const fechar = useFecharPilula();
  return (
    <button
      type="button"
      role={role}
      aria-checked={marcado}
      className={[styles.item, marcado ? styles.itemMarcado : ""].filter(Boolean).join(" ")}
      onClick={() => {
        onClick();
        if (fechaAoEscolher) fechar();
      }}
    >
      <span>{rotulo}</span>
      <span className={styles.aoLado}>
        {quantos !== undefined ? <span className={styles.quantos}>{quantos}</span> : null}
        {marcado ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
      </span>
    </button>
  );
}

/** Seleção única: escolher um item fecha o menu (Views, Período, Fala, Brasil ou fora, Ordem). */
export function ItemMenuRadio(props: PropsItem) {
  return <ItemMenu {...props} fechaAoEscolher role="menuitemradio" />;
}

/** Seleção múltipla: o menu continua aberto para marcar mais de um (Rede, Tipo de vídeo). */
export function ItemMenuCheckbox(props: PropsItem) {
  return <ItemMenu {...props} fechaAoEscolher={false} role="menuitemcheckbox" />;
}

"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { ramoPorSlug } from "@/config/ramos";
import type { Alcance, Plataforma, TipoMarca } from "@/db/schema";
import { textosContaAdmin } from "@/textos/admin-contas";
import { Botao } from "@/ui/componentes/Botao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";

import { renomearClienteAction, trocarPublicoDaContaAction, trocarRamoDaContaAction, trocarRedePrincipalAction, mudarTipoMarcaAction } from "./acoes";
import styles from "./IdentidadeAdmin.module.css";

const t = textosContaAdmin.identidade;
const tr = textosContaAdmin.trocar;

type Campo = "nome" | "tipo" | "ramo" | "rede" | "publico";

export type PublicoDaConta = { alcance: Alcance | null; regiao: string | null; pais: string | null; paises: string | null };

type Props = {
  clienteId: number;
  nome: string;
  tipo: TipoMarca;
  ramo: { nome: string; slug: string | null } | null;
  rede: Plataforma | null;
  publico: PublicoDaConta;
  /** O texto do público como a página mostra ("Local, em Campinas e região"). */
  publicoTexto: string;
  /** O ramo de hoje e os alternativos: não são opção na busca de um ramo novo. */
  ramosEscondidos: string[];
};

const REDES: { valor: Plataforma; nome: string }[] = [
  { valor: "instagram", nome: "Instagram" },
  { valor: "tiktok", nome: "TikTok" },
  { valor: "youtube", nome: "YouTube" },
];

const ALCANCES: { valor: Alcance; nome: string }[] = [
  { valor: "brasil", nome: tr.publicoBrasil },
  { valor: "local", nome: tr.publicoLocal },
  { valor: "outro_pais", nome: tr.publicoOutroPais },
  { valor: "mais_de_um_pais", nome: tr.publicoMaisPaises },
];

function Linha({ chave, rotulo, valor, salvoAgora, editando, aoTrocar, rotuloBotao, children, comErro }: { chave: Campo; rotulo: string; valor: ReactNode; salvoAgora: boolean; editando: boolean; aoTrocar: () => void; rotuloBotao: string; children: ReactNode; comErro?: boolean }) {
  if (editando) {
    return (
      <div className={[styles.campo, styles.editando, comErro ? styles.comErro : ""].filter(Boolean).join(" ")} data-campo={chave} data-editando="">
        <dt>{rotulo}</dt>
        <dd className={styles.editor}>{children}</dd>
      </div>
    );
  }
  return (
    <div className={styles.campo} data-campo={chave}>
      <dt>{rotulo}</dt>
      <dd>
        {valor}
        {salvoAgora ? (
          <span className={styles.salvoAgora} role="status">
            <Check size={14} strokeWidth={1.5} aria-hidden="true" />
            salvo agora
          </span>
        ) : null}
      </dd>
      <Botao variante="ghost" tamanho="md" onClick={aoTrocar} aria-label={rotuloBotao}>
        {t.trocar}
      </Botao>
    </div>
  );
}

/**
 * O bloco "Identidade" da página da conta (E46 PR 1, `AdminCliente.dc.html`): nome, tipo, ramo, rede principal e público, cada um com o botão "Trocar" ao lado, que abre o
 * campo ali mesmo. O ramo e o tipo avisam, antes de salvar, o que muda; o ramo usa a mesma busca de ramo do cliente. Cada troca é uma Server Action do admin que deixa uma linha
 * no registro (quem, o quê, antes e depois).
 */
export function IdentidadeAdmin({ clienteId, nome, tipo, ramo, rede, publico, publicoTexto, ramosEscondidos }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<Campo | null>(null);
  const [salvoAgora, setSalvoAgora] = useState<Campo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Rascunhos de cada editor.
  const [nomeNovo, setNomeNovo] = useState(nome);
  const [tipoNovo, setTipoNovo] = useState<TipoMarca>(tipo);
  const [ramoNovo, setRamoNovo] = useState<string | null>(null);
  const [redeNova, setRedeNova] = useState<Plataforma | null>(rede);
  const [alcanceNovo, setAlcanceNovo] = useState<Alcance>(publico.alcance ?? "brasil");
  const [regiaoNova, setRegiaoNova] = useState(publico.regiao ?? "");
  const [paisNovo, setPaisNovo] = useState(publico.pais ?? "");
  const [paisesNovos, setPaisesNovos] = useState(publico.paises ?? "");

  function abrir(campo: Campo) {
    setErro(null);
    setSalvoAgora(null);
    setNomeNovo(nome);
    setTipoNovo(tipo);
    setRamoNovo(null);
    setRedeNova(rede);
    setAlcanceNovo(publico.alcance ?? "brasil");
    setRegiaoNova(publico.regiao ?? "");
    setPaisNovo(publico.pais ?? "");
    setPaisesNovos(publico.paises ?? "");
    setEditando(campo);
  }

  function cancelar() {
    setEditando(null);
    setErro(null);
  }

  async function executar(campo: Campo, tarefa: () => Promise<{ ok: boolean; erro?: string }>, erroPadrao: string) {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await tarefa();
      if (!resultado.ok) {
        setErro(resultado.erro ?? erroPadrao);
        return;
      }
      setEditando(null);
      setSalvoAgora(campo);
      router.refresh();
    } catch {
      setErro(erroPadrao);
    } finally {
      setOcupado(false);
    }
  }

  const alcanceTexto = publicoTexto || t.semPublico;
  const nomeDoRamoNovo = ramoPorSlug(ramoNovo)?.nome ?? null;

  return (
    <dl className={styles.campos} data-identidade>
      <Linha chave="nome" rotulo={t.nome} valor={nome} salvoAgora={salvoAgora === "nome"} editando={editando === "nome"} aoTrocar={() => abrir("nome")} rotuloBotao="Editar nome" comErro={Boolean(erro)}>
        <form
          className={styles.formulario}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void executar("nome", () => renomearClienteAction(clienteId, nomeNovo), tr.erroLimite);
          }}
        >
          <input className={styles.entrada} aria-label={t.nome} value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} maxLength={80} autoFocus />
          {erro ? <p className={styles.erroCampo} role="alert"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />{erro}</p> : null}
          <div className={styles.acoes}>
            <Botao type="submit" tamanho="md" carregando={ocupado}>{tr.salvar}</Botao>
            <Botao type="button" variante="ghost" tamanho="md" disabled={ocupado} onClick={cancelar}>{tr.cancelar}</Botao>
          </div>
        </form>
      </Linha>

      <Linha chave="tipo" rotulo={t.tipo} valor={tipo === "pessoa" ? t.tipoPessoa : t.tipoNegocio} salvoAgora={salvoAgora === "tipo"} editando={editando === "tipo"} aoTrocar={() => abrir("tipo")} rotuloBotao="Trocar tipo" comErro={Boolean(erro)}>
        <div className={styles.chips} role="radiogroup" aria-label={tr.tipoTitulo(nome)}>
          {(["negocio", "pessoa"] as TipoMarca[]).map((valor) => (
            <button key={valor} type="button" role="radio" aria-checked={tipoNovo === valor} className={styles.chip} onClick={() => setTipoNovo(valor)}>
              {tipoNovo === valor ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
              {valor === "pessoa" ? t.tipoPessoa : t.tipoNegocio}
            </button>
          ))}
        </div>
        {tipoNovo !== tipo ? (
          <p className={styles.avisoTroca} data-aviso="tipo">
            <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>{tr.tipoAviso}</span>
          </p>
        ) : null}
        {erro ? <p className={styles.erroCampo} role="alert"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />{erro}</p> : null}
        <div className={styles.acoes}>
          <Botao tamanho="md" disabled={tipoNovo === tipo} carregando={ocupado} onClick={() => void executar("tipo", () => mudarTipoMarcaAction(clienteId, tipoNovo), tr.erroTipo)}>
            {tr.tipoBotao(tipoNovo === "pessoa" ? t.tipoPessoa : t.tipoNegocio)}
          </Botao>
          <Botao variante="ghost" tamanho="md" disabled={ocupado} onClick={cancelar}>{tr.cancelar}</Botao>
        </div>
      </Linha>

      <Linha chave="ramo" rotulo={t.ramo} valor={ramo?.nome ?? t.semRamo} salvoAgora={salvoAgora === "ramo"} editando={editando === "ramo"} aoTrocar={() => abrir("ramo")} rotuloBotao="Trocar ramo" comErro={Boolean(erro)}>
        <BuscaDeRamo rotulo={tr.ramoTitulo(nome)} valor={ramoNovo} ramosEscondidos={ramosEscondidos} onEscolher={setRamoNovo} />
        {nomeDoRamoNovo ? (
          <p className={styles.avisoTroca} data-aviso="ramo">
            <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>{tr.ramoAviso}</span>
          </p>
        ) : null}
        {erro ? <p className={styles.erroCampo} role="alert"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />{erro}</p> : null}
        <div className={styles.acoes}>
          <Botao tamanho="md" disabled={!ramoNovo} carregando={ocupado} onClick={() => ramoNovo && void executar("ramo", () => trocarRamoDaContaAction(clienteId, ramoNovo), tr.erroRamo)}>
            {nomeDoRamoNovo ? tr.ramoBotao(nomeDoRamoNovo) : tr.ramoBotao("...")}
          </Botao>
          <Botao variante="ghost" tamanho="md" disabled={ocupado} onClick={cancelar}>{tr.cancelar}</Botao>
        </div>
      </Linha>

      <Linha chave="rede" rotulo={t.rede} valor={REDES.find((r) => r.valor === rede)?.nome ?? t.semRede} salvoAgora={salvoAgora === "rede"} editando={editando === "rede"} aoTrocar={() => abrir("rede")} rotuloBotao="Trocar rede principal" comErro={Boolean(erro)}>
        <div className={styles.chips} role="radiogroup" aria-label={tr.redeTitulo(nome)}>
          {REDES.map((r) => (
            <button key={r.valor} type="button" role="radio" aria-checked={redeNova === r.valor} className={styles.chip} onClick={() => setRedeNova(r.valor)}>
              {redeNova === r.valor ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
              {r.nome}
            </button>
          ))}
        </div>
        {erro ? <p className={styles.erroCampo} role="alert"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />{erro}</p> : null}
        <div className={styles.acoes}>
          <Botao tamanho="md" disabled={!redeNova || redeNova === rede} carregando={ocupado} onClick={() => redeNova && void executar("rede", () => trocarRedePrincipalAction(clienteId, redeNova), tr.erroRede)}>
            {redeNova ? tr.redeBotao(REDES.find((r) => r.valor === redeNova)!.nome) : tr.salvar}
          </Botao>
          <Botao variante="ghost" tamanho="md" disabled={ocupado} onClick={cancelar}>{tr.cancelar}</Botao>
        </div>
      </Linha>

      <Linha chave="publico" rotulo={t.publico} valor={alcanceTexto} salvoAgora={salvoAgora === "publico"} editando={editando === "publico"} aoTrocar={() => abrir("publico")} rotuloBotao="Trocar público" comErro={Boolean(erro)}>
        <div className={styles.chips} role="radiogroup" aria-label={tr.publicoTitulo(nome)}>
          {ALCANCES.map((a) => (
            <button key={a.valor} type="button" role="radio" aria-checked={alcanceNovo === a.valor} className={styles.chip} onClick={() => setAlcanceNovo(a.valor)}>
              {alcanceNovo === a.valor ? <Check size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
              {a.nome}
            </button>
          ))}
        </div>
        {alcanceNovo === "local" ? <input className={styles.entrada} aria-label={tr.campoRegiao} placeholder={tr.campoRegiao} value={regiaoNova} onChange={(e) => setRegiaoNova(e.target.value)} /> : null}
        {alcanceNovo === "outro_pais" ? <input className={styles.entrada} aria-label={tr.campoPais} placeholder={tr.campoPais} value={paisNovo} onChange={(e) => setPaisNovo(e.target.value)} /> : null}
        {alcanceNovo === "mais_de_um_pais" ? <input className={styles.entrada} aria-label={tr.campoPaises} placeholder={tr.campoPaises} value={paisesNovos} onChange={(e) => setPaisesNovos(e.target.value)} /> : null}
        {erro ? <p className={styles.erroCampo} role="alert"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />{erro === tr.erroLimite ? tr.publicoErro : erro}</p> : null}
        <div className={styles.acoes}>
          <Botao tamanho="md" carregando={ocupado} onClick={() => void executar("publico", () => trocarPublicoDaContaAction(clienteId, { alcance: alcanceNovo, regiao: regiaoNova, pais: paisNovo, paises: paisesNovos }), tr.publicoErro)}>
            {tr.salvar}
          </Botao>
          <Botao variante="ghost" tamanho="md" disabled={ocupado} onClick={cancelar}>{tr.cancelar}</Botao>
        </div>
      </Linha>
    </dl>
  );
}

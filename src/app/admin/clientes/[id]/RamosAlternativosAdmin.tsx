"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAXIMO_DE_RAMOS_ALTERNATIVOS } from "@/lib/ramos-alternativos";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";

import { ligarRamoAlternativoAction, previaDeLigarRamoAction, tirarRamoAlternativoAction, type PreviaNaTela } from "./acoes";
import styles from "./RamosAlternativosAdmin.module.css";

const t = textosAdmin.ramosAlternativos;

type Props = {
  clienteId: number;
  nomeMarca: string;
  /** O ramo principal da marca (o slug é nulo para um setor feito à mão). Nulo: a marca ainda não tem ramo. */
  principal: { nome: string; slug: string | null } | null;
  alternativos: { id: number; nome: string; slug: string | null; ligadoEm: string }[];
};

function formatarData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

/**
 * E45 PR 3: "Ramos alternativos" na página da marca (`/admin/clientes/[id]`, no estilo do admin de hoje; o desenho novo vem na E46). Até dois
 * ramos além do principal, que só o admin liga e desliga. Antes de confirmar a ligação o admin vê se o setor já é pesquisado (sem custo novo)
 * ou se vai começar a ser (uns US$ 0,60 por dia enquanto tiver marca): nada nasce sem um clique dele.
 */
export function RamosAlternativosAdmin({ clienteId, nomeMarca, principal, alternativos }: Props) {
  const router = useRouter();
  const [ligando, setLigando] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaNaTela | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cheio = alternativos.length >= MAXIMO_DE_RAMOS_ALTERNATIVOS;
  const escondidos = [principal?.slug, ...alternativos.map((a) => a.slug)].filter((s): s is string => Boolean(s));

  function abrir() {
    setLigando(true);
    setSlug(null);
    setPrevia(null);
    setErro(null);
  }

  function fechar() {
    setLigando(false);
    setSlug(null);
    setPrevia(null);
    setErro(null);
  }

  async function escolher(novo: string) {
    setSlug(novo);
    setPrevia(null);
    setErro(null);
    const resultado = await previaDeLigarRamoAction(novo);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setPrevia(resultado.dado);
  }

  async function confirmar() {
    if (!slug) return;
    setOcupado(true);
    setErro(null);
    const resultado = await ligarRamoAlternativoAction(clienteId, slug);
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    fechar();
    router.refresh();
  }

  async function tirar(id: number) {
    setOcupado(true);
    setErro(null);
    const resultado = await tirarRamoAlternativoAction(clienteId, id);
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    router.refresh();
  }

  return (
    <section className={styles.secao} aria-labelledby="ramos-alternativos-titulo" data-ramos-alternativos>
      <h2 id="ramos-alternativos-titulo" className={styles.titulo}>
        {t.titulo}
      </h2>
      <p className={styles.ajuda}>{t.ajuda}</p>
      <p className={styles.detalhe}>{principal ? t.principal(principal.nome) : t.semPrincipal}</p>

      {alternativos.length === 0 ? (
        <p className={styles.vazio}>{t.vazio}</p>
      ) : (
        <ul className={styles.lista}>
          {alternativos.map((alternativo) => (
            <li key={alternativo.id} className={styles.item} data-ramo-alternativo={alternativo.id}>
              <div className={styles.texto}>
                <strong>{alternativo.nome}</strong>
                <span className={styles.detalhe}>{t.desde(formatarData(alternativo.ligadoEm))}</span>
              </div>
              <Botao variante="secundario" disabled={ocupado} onClick={() => tirar(alternativo.id)}>
                {t.tirar}
              </Botao>
            </li>
          ))}
        </ul>
      )}

      {!ligando && principal ? (
        <div className={styles.acoes}>
          <Botao variante="secundario" disabled={cheio} onClick={abrir}>
            {t.ligar}
          </Botao>
          {cheio ? <span className={styles.detalhe}>{t.cheio}</span> : null}
        </div>
      ) : null}

      {ligando ? (
        <div className={styles.encaixe}>
          <BuscaDeRamo rotulo={t.ligarRotulo(nomeMarca)} valor={slug} ramosEscondidos={escondidos} onEscolher={escolher} />
          {previa ? (
            <p className={styles.previa} data-previa-ramo={previa.estado}>
              {previa.estado === "pesquisado" ? t.jaPesquisado(previa.nome) : t.vaiComecar(previa.nome, previa.custoPorDia)}
            </p>
          ) : null}
          <div className={styles.acoes}>
            <Botao disabled={!slug || !previa} carregando={ocupado} onClick={confirmar}>
              {ocupado ? t.ligando : previa ? t.confirmar(previa.nome) : t.ligar}
            </Botao>
            <Botao variante="ghost" disabled={ocupado} onClick={fechar}>
              {t.cancelar}
            </Botao>
          </div>
        </div>
      ) : null}

      {erro ? (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      ) : null}
    </section>
  );
}

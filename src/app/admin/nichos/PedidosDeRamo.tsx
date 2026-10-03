"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ramoPorSlug } from "@/config/ramos";
import type { PedidoNaLista } from "@/servicos/pedidos-de-ramo";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { BuscaDeRamo } from "@/ui/componentes/BuscaDeRamo";

import { encaixarPedidoAction } from "./acoes";
import styles from "./PedidosDeRamo.module.css";

const t = textosAdmin.pedidosDeRamo;

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

/**
 * E45 PR 2: os pedidos de ramo abertos (o "Não achei o meu" dos clientes), na página de Nichos. Cada um mostra a marca, o que a pessoa escreveu e o
 * ramo provisório em que ela espera, e tem dois caminhos, sempre decididos por quem administra (nunca setor novo sozinho): "encaixar em um que
 * existe" (a mesma busca de ramo do cliente; a marca vai para o setor dele e o pedido fecha) e "criar ramo" (abre o novo nicho já preenchido).
 */
export function PedidosDeRamo({ pedidos, aoCriarRamo }: { pedidos: PedidoNaLista[]; aoCriarRamo: (pedido: PedidoNaLista) => void }) {
  const router = useRouter();
  const [encaixandoId, setEncaixandoId] = useState<number | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrirEncaixe(id: number) {
    setEncaixandoId((atual) => (atual === id ? null : id));
    setSlug(null);
    setErro(null);
  }

  async function encaixar(id: number) {
    if (!slug) return;
    setSalvando(true);
    setErro(null);
    const resultado = await encaixarPedidoAction(id, slug);
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.mensagem ?? t.erro);
      return;
    }
    setEncaixandoId(null);
    setSlug(null);
    router.refresh();
  }

  return (
    <section className={styles.secao} aria-labelledby="pedidos-de-ramo-titulo">
      <h2 id="pedidos-de-ramo-titulo" className={styles.titulo}>
        {t.titulo}
      </h2>
      <p className={styles.subtitulo}>{t.subtitulo(pedidos.length)}</p>
      <p className={styles.ajuda}>{t.ajuda}</p>
      <ul className={styles.lista}>
        {pedidos.map((pedido) => (
          <li key={pedido.id} className={styles.item} data-pedido-de-ramo={pedido.id}>
            <div className={styles.linha}>
              <div className={styles.texto}>
                <p className={styles.frase}>
                  <strong>{pedido.marca.nome}</strong> {t.escreveu} <q className={styles.citacao}>{pedido.texto}</q>
                </p>
                <p className={styles.detalhe}>
                  {pedido.setorProvisorio ? t.provisorio(pedido.setorProvisorio.nome) : pedido.ramoAtual ? t.semProvisorioNoRamo(pedido.ramoAtual.nome) : t.semProvisorio} · {t.quando(formatarData(pedido.criadoEm))}
                </p>
              </div>
              <div className={styles.acoes}>
                <Botao variante="secundario" aria-expanded={encaixandoId === pedido.id} onClick={() => abrirEncaixe(pedido.id)}>
                  {t.encaixar}
                </Botao>
                <Botao variante="secundario" onClick={() => aoCriarRamo(pedido)}>
                  {t.criar}
                </Botao>
              </div>
            </div>
            {encaixandoId === pedido.id ? (
              <div className={styles.encaixe}>
                <BuscaDeRamo rotulo={t.encaixarRotulo(pedido.marca.nome)} valor={slug} onEscolher={setSlug} />
                <div className={styles.acoes}>
                  <Botao disabled={!slug} carregando={salvando} onClick={() => encaixar(pedido.id)}>
                    {salvando ? t.encaixando : slug ? t.confirmarEncaixe(ramoPorSlug(slug)?.nome ?? slug) : t.encaixar}
                  </Botao>
                  <Botao variante="ghost" onClick={() => abrirEncaixe(pedido.id)}>
                    {t.cancelar}
                  </Botao>
                </div>
                {erro ? (
                  <p className={styles.erro} role="alert">
                    {erro}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

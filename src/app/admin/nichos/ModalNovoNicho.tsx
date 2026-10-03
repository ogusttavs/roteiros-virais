"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { criarNichoAction, criarRamoDoPedidoAction } from "./acoes";
import styles from "./ModalNovoNicho.module.css";

const t = textosAdmin.nichos;

type Props = {
  aberto: boolean;
  onFechar: () => void;
  /** E45 PR 2: aberto a partir de um pedido de ramo, o nome começa com o que a pessoa escreveu, e salvar também move a marca e fecha o pedido. */
  pedido?: { id: number; texto: string; marcaNome: string };
};

/** O texto do pedido com a primeira letra maiúscula, para ser o nome do ramo novo. */
function nomeDoPedido(texto: string): string {
  const limpo = texto.trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export function ModalNovoNicho({ aberto, onFechar, pedido }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState(pedido ? nomeDoPedido(pedido.texto) : "");
  const [descricao, setDescricao] = useState("");
  const [termosBruto, setTermosBruto] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    setCriando(true);
    setErro(null);
    const resultado = pedido
      ? await criarRamoDoPedidoAction(pedido.id, { nome, descricao, termosBruto })
      : await criarNichoAction({ nome, descricao, termosBruto });
    setCriando(false);
    if (!resultado.ok) {
      setErro(resultado.mensagem ?? t.erroCriar);
      return;
    }
    setNome("");
    setDescricao("");
    setTermosBruto("");
    onFechar();
    router.refresh();
  }

  return aberto ? (
    <div className={styles.backdrop} onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pedido ? t.modalTituloPedido : t.modalTitulo}
        className={styles.painel}
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 className={styles.titulo}>{pedido ? t.modalTituloPedido : t.modalTitulo}</h2>
        {pedido ? <p className={styles.avisoPedido}>{t.avisoPedido(pedido.marcaNome, pedido.texto)}</p> : null}
        <form className={styles.forma} onSubmit={criar}>
          <Campo rotulo={t.campoNome} required value={nome} onChange={(e) => setNome(e.target.value)} />
          <Campo rotulo={t.campoDescricao} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <AreaTexto
            rotulo={t.campoTermos}
            ajuda={t.ajudaTermos}
            required
            linhasMin={6}
            value={termosBruto}
            onChange={(e) => setTermosBruto(e.target.value)}
          />
          {erro ? (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          ) : null}
          <Botao type="submit" tamanho="lg" carregando={criando}>
            {criando ? t.criando : pedido ? t.botaoCriarPedido : t.botaoCriar}
          </Botao>
        </form>
      </div>
    </div>
  ) : null;
}

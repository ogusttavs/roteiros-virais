"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { criarNichoAction } from "./acoes";
import styles from "./ModalNovoNicho.module.css";

const t = textosAdmin.nichos;

type Props = {
  aberto: boolean;
  onFechar: () => void;
};

export function ModalNovoNicho({ aberto, onFechar }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [termosBruto, setTermosBruto] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    setCriando(true);
    setErro(null);
    const resultado = await criarNichoAction({ nome, descricao, termosBruto });
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
        aria-label={t.modalTitulo}
        className={styles.painel}
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 className={styles.titulo}>{t.modalTitulo}</h2>
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
            {criando ? t.criando : t.botaoCriar}
          </Botao>
        </form>
      </div>
    </div>
  ) : null;
}

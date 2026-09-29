"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { renomearClienteAction } from "./acoes";
import styles from "./page.module.css";

const t = textosAdmin.clienteDetalhe;

type Props = {
  clienteId: number;
  nomeInicial: string;
};

/** O nome da marca, editável ao lado do título (V12b, item 3; mesmo padrão de `PainelNicho`). */
export function NomeMarcaAdmin({ clienteId, nomeInicial }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(nomeInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    const resultado = await renomearClienteAction(clienteId, nome);
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setEditando(false);
    router.refresh();
  }

  if (editando) {
    return (
      <form className={styles.formaNome} onSubmit={salvar}>
        <Campo
          rotulo={textosAdmin.clientes.campoNome}
          rotuloOculto
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        {erro ? (
          <p className={styles.erroNome} role="alert">
            {erro}
          </p>
        ) : null}
        <div className={styles.botoesNome}>
          <Botao type="submit" tamanho="md" carregando={salvando}>
            {salvando ? t.salvandoNome : t.salvarNome}
          </Botao>
          <Botao
            type="button"
            variante="ghost"
            tamanho="md"
            disabled={salvando}
            onClick={() => {
              setNome(nomeInicial);
              setErro(null);
              setEditando(false);
            }}
          >
            {t.cancelarNome}
          </Botao>
        </div>
      </form>
    );
  }

  return (
    <div className={styles.linhaNomeMarca}>
      <h1>{nomeInicial}</h1>
      <Botao type="button" variante="ghost" tamanho="md" onClick={() => setEditando(true)}>
        {t.editarNome}
      </Botao>
    </div>
  );
}

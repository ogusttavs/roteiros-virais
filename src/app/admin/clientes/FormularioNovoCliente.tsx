"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { criarClienteAction } from "./acoes";
import styles from "./FormularioNovoCliente.module.css";

const t = textosAdmin.clientes;

export function FormularioNovoCliente({ nichos }: { nichos: { id: number; nome: string }[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [nichoId, setNichoId] = useState(nichos[0]?.id ?? 0);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(
    null,
  );

  async function criar(evento: FormEvent) {
    evento.preventDefault();
    setCriando(true);
    setMensagem(null);

    try {
      await criarClienteAction({ nome, email, nichoId });
      setMensagem({ tipo: "sucesso", texto: t.sucesso(email) });
      setNome("");
      setEmail("");
      router.refresh();
    } catch {
      setMensagem({ tipo: "erro", texto: t.erro });
    } finally {
      setCriando(false);
    }
  }

  return (
    <form className={styles.forma} onSubmit={criar}>
      <Campo
        rotulo={t.campoNome}
        required
        value={nome}
        onChange={(evento) => setNome(evento.target.value)}
      />
      <Campo
        rotulo={t.campoEmail}
        type="email"
        required
        value={email}
        onChange={(evento) => setEmail(evento.target.value)}
      />
      <label className={styles.rotulo}>
        {t.campoNicho}
        <select
          className={styles.select}
          value={nichoId}
          onChange={(evento) => setNichoId(Number(evento.target.value))}
        >
          {nichos.map((nicho) => (
            <option key={nicho.id} value={nicho.id}>
              {nicho.nome}
            </option>
          ))}
        </select>
      </label>
      {mensagem ? (
        <p className={`${styles.mensagem} ${styles[mensagem.tipo]}`} role="status">
          {mensagem.texto}
        </p>
      ) : null}
      <Botao type="submit" carregando={criando}>
        {criando ? t.criando : t.botaoCriar}
      </Botao>
    </form>
  );
}

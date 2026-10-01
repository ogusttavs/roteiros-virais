import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * E39a: `/hoje/objetivo` virou `/criar/objetivo` (a agenda não cria mais nada). Link ou atalho
 * salvo de antes continua abrindo, com os mesmos parâmetros (`?tema=` ou `?livre=`).
 */
export default async function ObjetivoRedirecionado({ searchParams }: Props) {
  const parametros = new URLSearchParams();
  for (const [chave, valor] of Object.entries(await searchParams)) {
    if (typeof valor === "string") parametros.set(chave, valor);
  }
  const consulta = parametros.toString();
  redirect(consulta ? `/criar/objetivo?${consulta}` : "/criar/objetivo");
}

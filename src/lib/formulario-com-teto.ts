import { lerCorpoComTeto } from "@/lib/porta-do-carrossel";

/**
 * Achado M5 da auditoria de 26/11/2026: `request.formData()` lê o corpo inteiro na memória ANTES de qualquer conferência de tamanho. Aqui o corpo é lido em fluxo, contando os bytes; passou do
 * teto, a leitura para e devolve `"grande-demais"`. Corpo que não é um formulário lança, como o `formData()` original.
 */
export async function lerFormularioComTeto(request: Request, teto: number): Promise<FormData | "grande-demais"> {
  const bytes = await lerCorpoComTeto(request, teto);
  if (bytes === "grande-demais") return "grande-demais";
  const tipo = request.headers.get("content-type") ?? "";
  return new Response(bytes, { headers: { "content-type": tipo } }).formData();
}

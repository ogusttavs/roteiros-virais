/**
 * Hashtag válida para as duas plataformas que buscam por termo (achado do
 * dia 1 da conferência de produção, 10/09/2026): a Apify já tirava espaço
 * (`apify-api.ts`, antes uma função privada `paraHashtag`), mas a Meta é
 * mais estrita. `meta-hashtags.ts` mandava o termo cru do nicho
 * (`ig_hashtag_search`, "limpeza a seco", "mancha no sofa") e a Meta
 * respondia "The requested resource does not exist" para 8 dos 10 termos
 * da Dr.Wash: o job terminava "ok" com `videosNovos: 0` todo dia desde o
 * deploy, sem nenhum erro visível.
 *
 * Minúsculo, sem acento, só letra, número e underscore: o exemplo da
 * própria documentação da Meta usa minúsculo sem "#" (`q=bluebottle`), e
 * hashtag de verdade (a que aparece no aplicativo) nunca tem espaço,
 * acento nem pontuação. `hashtags_meta_usadas.termo` e `nichos.termos`
 * continuam com o termo original do nicho; só o que vai para a Meta e para
 * a Apify passa por aqui.
 */
export function normalizarHashtag(termo: string): string {
  return termo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

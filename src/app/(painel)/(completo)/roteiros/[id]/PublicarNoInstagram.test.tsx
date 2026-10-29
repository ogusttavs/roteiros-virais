/**
 * A folha "Publicar no Instagram" do roteiro (E56 PR 1), estado por estado: o formulário com a legenda do roteiro já preenchida, Reels e Story, o arquivo (tipo e duração), o envio com andamento,
 * a espera da Meta, o publicado, a falha com o motivo, o cancelar, o envio de antes que não terminou e a folha sem condição de publicar. As três Server Actions, o envio (XMLHttpRequest) e o
 * contexto de conexão saem simulados: o que importa é o que a tela mostra e o que ela pede ao servidor.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VisaoDePublicar, VistaDaPublicacao } from "@/servicos/publicar-instagram";
import { fraseDeFalha, fraseDeRecusa, textosPublicar } from "@/textos/publicar";

const iniciarPublicacaoAction = vi.fn();
const conferirPublicacaoAction = vi.fn();
const cancelarEnvioAction = vi.fn();
const publicarEdicaoAction = vi.fn();

// E47 PR 4: publicar o vídeo editado que já está no servidor.
vi.mock("./edicao-acoes", () => ({
  publicarEdicaoAction: (...args: unknown[]) => publicarEdicaoAction(...args),
}));

vi.mock("./publicar-acoes", () => ({
  iniciarPublicacaoAction: (...args: unknown[]) => iniciarPublicacaoAction(...args),
  conferirPublicacaoAction: (...args: unknown[]) => conferirPublicacaoAction(...args),
  cancelarEnvioAction: (...args: unknown[]) => cancelarEnvioAction(...args),
}));

vi.mock("@/ui/ConexaoContext", () => ({
  ID_FAIXA_SEM_CONEXAO: "faixa-sem-conexao",
  useConexao: () => ({ semConexao: false, avisarRedeOk: vi.fn() }),
  useTratarFalha: () => (_erro: unknown, padrao: string) => padrao,
}));

import { PublicarNoInstagram } from "./PublicarNoInstagram";

const t = textosPublicar.tela;

// ---------------------------------------------------------------------------
// O envio simulado
// ---------------------------------------------------------------------------

class EnvioFalso {
  static ultimo: EnvioFalso | null = null;
  metodo = "";
  endereco = "";
  cabecalhos: Record<string, string> = {};
  corpo: unknown = null;
  abortado = false;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(metodo: string, endereco: string) {
    this.metodo = metodo;
    this.endereco = endereco;
  }
  setRequestHeader(nome: string, valor: string) {
    this.cabecalhos[nome.toLowerCase()] = valor;
  }
  send(corpo: unknown) {
    this.corpo = corpo;
    EnvioFalso.ultimo = this;
  }
  abort() {
    this.abortado = true;
    this.onabort?.();
  }
  progresso(carregado: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded: carregado, total });
  }
  responder(status: number, corpo: unknown = {}) {
    this.status = status;
    this.responseText = JSON.stringify(corpo);
    this.onload?.();
  }
}

// ---------------------------------------------------------------------------
// A folha, com o pai que guarda a publicação (como o roteiro faz)
// ---------------------------------------------------------------------------

const VISAO: VisaoDePublicar = {
  situacao: { pode: true, conta: "casa.em.ordem" },
  legenda: "Três erros ao lavar a louça\n\nChame no WhatsApp.",
  tipoInicial: "reels",
  megas: { reels: 300, story: 100 },
  publicacao: null,
};

const aoEnviando = vi.fn();
const aoMudarObservado = vi.fn();

function Pai({ visao = VISAO, inicial = null, edicaoPronta = null }: { visao?: VisaoDePublicar; inicial?: VistaDaPublicacao | null; edicaoPronta?: { id: number; duracaoS: number | null } | null }) {
  const [publicacao, setPublicacao] = useState<VistaDaPublicacao | null>(inicial);
  return (
    <PublicarNoInstagram
      roteiroId={25}
      visao={visao}
      publicacao={publicacao}
      aoMudar={(v) => {
        aoMudarObservado(v);
        setPublicacao(v);
      }}
      aoEnviando={aoEnviando}
      semConexao={false}
      edicaoPronta={edicaoPronta}
    />
  );
}

function arquivo(nome = "meu-video.mp4", tipo = "video/mp4", bytes = 2048): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

function escolher(file: File) {
  const campo = document.querySelector<HTMLInputElement>("input[type=file]");
  if (!campo) throw new Error("sem campo de arquivo");
  fireEvent.change(campo, { target: { files: [file] } });
}

const vista = (extra: Partial<VistaDaPublicacao> = {}): VistaDaPublicacao => ({ id: 7, tipo: "reels", estado: "enviando", motivo: null, permalink: null, ...extra });

beforeEach(() => {
  iniciarPublicacaoAction.mockReset();
  conferirPublicacaoAction.mockReset();
  cancelarEnvioAction.mockReset();
  publicarEdicaoAction.mockReset();
  aoEnviando.mockReset();
  aoMudarObservado.mockReset();
  EnvioFalso.ultimo = null;
  vi.stubGlobal("XMLHttpRequest", EnvioFalso);
  // O jsdom não lê vídeo: o endereço do arquivo e o elemento de vídeo ficam por conta do teste.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:falso", revokeObjectURL: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o formulário", () => {
  it("traz a legenda do roteiro preenchida, Reels marcado, o contador e o botão apagado até escolher o vídeo", () => {
    render(<Pai />);
    expect(screen.getByRole("heading", { name: t.titulo })).toBeTruthy();
    expect(screen.getByText(t.sai("casa.em.ordem"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t.reels }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: t.story }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByLabelText(t.legenda) as HTMLTextAreaElement).value).toBe(VISAO.legenda);
    expect(screen.getByText(t.contador([...VISAO.legenda].length))).toBeTruthy();
    expect(screen.getByText(t.ajudaReels(300))).toBeTruthy();
    expect((screen.getByRole("button", { name: t.publicar }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Story: some o campo da legenda e a ajuda diz que o Story não leva legenda; voltar a Reels traz a legenda de volta", () => {
    render(<Pai />);
    fireEvent.click(screen.getByRole("button", { name: t.story }));
    expect(screen.queryByLabelText(t.legenda)).toBeNull();
    expect(screen.getByText(t.ajudaStory(100))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.reels }));
    expect((screen.getByLabelText(t.legenda) as HTMLTextAreaElement).value).toBe(VISAO.legenda);
  });

  it("o roteiro de Story já abre em Story", () => {
    render(<Pai visao={{ ...VISAO, tipoInicial: "story" }} />);
    expect(screen.getByRole("button", { name: t.story }).getAttribute("aria-pressed")).toBe("true");
  });

  it("arquivo que não é MP4 nem MOV: avisa na hora e mantém o botão apagado", () => {
    render(<Pai />);
    escolher(arquivo("anotacoes.txt", "text/plain"));
    expect(screen.getByRole("alert").textContent).toContain(fraseDeRecusa("arquivo-tipo"));
    expect((screen.getByRole("button", { name: t.publicar }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("MOV do celular passa (o tipo é video/quicktime), e a extensão vale quando o aparelho não diz o tipo", () => {
    render(<Pai />);
    escolher(arquivo("IMG_0001.MOV", "video/quicktime"));
    expect(screen.getByText(t.videoEscolhido("IMG_0001.MOV", "0"))).toBeTruthy();
    expect((screen.getByRole("button", { name: t.publicar }) as HTMLButtonElement).disabled).toBe(false);
    escolher(arquivo("gravacao.mov", ""));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("legenda acima do limite do Instagram: avisa, e nada vai ao servidor", async () => {
    render(<Pai />);
    escolher(arquivo());
    fireEvent.change(screen.getByLabelText(t.legenda), { target: { value: "a".repeat(2300) } });
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    expect((await screen.findByRole("alert")).textContent).toContain(fraseDeRecusa("legenda-longa"));
    expect(iniciarPublicacaoAction).not.toHaveBeenCalled();
  });

  it("vídeo curto ou longo demais para o tipo: a duração lida do arquivo barra antes de enviar", async () => {
    const criar = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag !== "video") return criar(tag);
      const falso = { preload: "", duration: 90, onloadedmetadata: null as null | (() => void), onerror: null, removeAttribute: () => undefined, set src(_v: string) { queueMicrotask(() => this.onloadedmetadata?.()); } };
      return falso as unknown as HTMLVideoElement;
    }) as typeof document.createElement);
    render(<Pai visao={{ ...VISAO, tipoInicial: "story" }} />);
    escolher(arquivo());
    expect((await screen.findByRole("alert")).textContent).toContain(t.duracaoLonga("story", "60 segundos"));
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    expect(iniciarPublicacaoAction).not.toHaveBeenCalled();
  });
});

describe("publicar", () => {
  it("do toque ao post: pede ao servidor com o que a pessoa confirmou, envia o arquivo com andamento, espera a Meta e mostra o link", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 7 } });
    conferirPublicacaoAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "publicada", permalink: "https://www.instagram.com/reel/ABC123/" }), reconferirEmSeg: null } });
    render(<Pai />);
    escolher(arquivo("meu-video.mp4", "video/mp4", 4096));
    fireEvent.change(screen.getByLabelText(t.legenda), { target: { value: "Minha legenda #oferta" } });
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));

    await waitFor(() => expect(EnvioFalso.ultimo).not.toBeNull());
    expect(iniciarPublicacaoAction).toHaveBeenCalledWith(25, { tipo: "reels", legenda: "Minha legenda #oferta", tamanhoBytes: 4096, tipoDoArquivo: "video/mp4", nomeDoArquivo: "meu-video.mp4" });
    const envio = EnvioFalso.ultimo!;
    expect(envio.metodo).toBe("PUT");
    expect(envio.endereco).toBe("/api/publicar/7/video");
    expect(envio.cabecalhos["content-type"]).toBe("video/mp4");
    expect((envio.corpo as File).name).toBe("meu-video.mp4");

    // Enviando, com o andamento (e a folha avisa o pai para não fechar).
    act(() => envio.progresso(2048, 4096));
    expect(await screen.findByText(t.enviando(50))).toBeTruthy();
    expect(screen.getByText(t.naoFechar)).toBeTruthy();
    expect(aoEnviando).toHaveBeenLastCalledWith(true);

    // O servidor recebeu tudo: a Meta prepara, a folha pergunta e mostra o publicado.
    act(() => envio.responder(200, { ok: true }));
    await waitFor(() => expect(conferirPublicacaoAction).toHaveBeenCalledWith(7));
    const publicada = await screen.findByText(t.publicada);
    expect(publicada).toBeTruthy();
    const link = screen.getByRole("link", { name: t.verNoInstagram });
    expect(link.getAttribute("href")).toBe("https://www.instagram.com/reel/ABC123/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(t.marcadoComoPostado)).toBeTruthy();
    expect(aoMudarObservado).toHaveBeenCalledWith(expect.objectContaining({ estado: "publicada" }));
    expect(aoEnviando).toHaveBeenLastCalledWith(false);
  });

  it("enquanto a Meta prepara, a folha mostra a espera e não deixa publicar de novo", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 7 } });
    conferirPublicacaoAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "processando" }), reconferirEmSeg: 60 } });
    render(<Pai />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    await waitFor(() => expect(EnvioFalso.ultimo).not.toBeNull());
    act(() => EnvioFalso.ultimo!.responder(200, { ok: true }));
    expect(await screen.findByText(t.processando)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.publicar })).toBeNull();
  });

  it("o servidor recusa começar (por exemplo, o limite do dia): mostra a frase dele, sem enviar nada", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: false, erro: fraseDeRecusa("limite") });
    render(<Pai />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    expect((await screen.findByRole("alert")).textContent).toContain(fraseDeRecusa("limite"));
    expect(EnvioFalso.ultimo).toBeNull();
    expect((screen.getByRole("button", { name: t.publicar }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a Meta recusa o vídeo no envio: a frase aparece uma vez só, o botão vira Tentar de novo e o arquivo e a legenda continuam", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 7 } });
    render(<Pai />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    await waitFor(() => expect(EnvioFalso.ultimo).not.toBeNull());
    act(() => EnvioFalso.ultimo!.responder(502, { erro: fraseDeFalha("formato") }));
    await screen.findByRole("button", { name: t.tentarDeNovo });
    expect(screen.getAllByText(fraseDeFalha("formato"))).toHaveLength(1);
    expect(screen.getByText(t.videoEscolhido("meu-video.mp4", "0"))).toBeTruthy();
    expect((screen.getByLabelText(t.legenda) as HTMLTextAreaElement).value).toBe(VISAO.legenda);
    expect(aoEnviando).toHaveBeenLastCalledWith(false);
  });

  it("a rede cai no meio do envio: frase de conexão, e dá para tentar de novo", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 7 } });
    render(<Pai />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    await waitFor(() => expect(EnvioFalso.ultimo).not.toBeNull());
    act(() => EnvioFalso.ultimo!.onerror?.());
    expect(await screen.findByRole("button", { name: t.tentarDeNovo })).toBeTruthy();
    expect(screen.getByRole("alert").textContent?.length).toBeGreaterThan(10);
  });

  it("cancelar o envio: interrompe o pedido, avisa o servidor e volta ao formulário", async () => {
    iniciarPublicacaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 7 } });
    cancelarEnvioAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "falhou", motivo: fraseDeFalha("envio-interrompido") }) } });
    render(<Pai />);
    escolher(arquivo());
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    await waitFor(() => expect(EnvioFalso.ultimo).not.toBeNull());
    act(() => EnvioFalso.ultimo!.progresso(10, 100));
    fireEvent.click(await screen.findByRole("button", { name: t.cancelar }));
    await waitFor(() => expect(cancelarEnvioAction).toHaveBeenCalledWith(7));
    expect(EnvioFalso.ultimo!.abortado).toBe(true);
    expect(await screen.findByRole("button", { name: t.tentarDeNovo })).toBeTruthy();
  });
});

describe("outros estados da folha", () => {
  it("um envio de antes que não terminou (a página recarregou no meio): só dá para cancelar", async () => {
    cancelarEnvioAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "falhou", motivo: fraseDeFalha("envio-interrompido") }) } });
    render(<Pai inicial={vista({ estado: "enviando" })} />);
    expect(screen.getByText(t.envioAnterior)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.publicar })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.cancelar }));
    await waitFor(() => expect(cancelarEnvioAction).toHaveBeenCalledWith(7));
    expect(await screen.findByRole("button", { name: t.tentarDeNovo })).toBeTruthy();
    expect(screen.queryByText(t.envioAnterior)).toBeNull();
  });

  it("uma publicação em preparo de antes: a folha volta a perguntar e mostra o resultado", async () => {
    conferirPublicacaoAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "publicada", permalink: null }), reconferirEmSeg: null } });
    render(<Pai inicial={vista({ estado: "processando" })} />);
    expect(screen.getByText(t.processando)).toBeTruthy();
    expect(await screen.findByText(t.publicadaSemLink)).toBeTruthy();
    expect(screen.queryByRole("link", { name: t.verNoInstagram })).toBeNull();
  });

  it("uma publicação que falhou antes mostra o motivo no topo do formulário", () => {
    render(<Pai inicial={vista({ estado: "falhou", motivo: fraseDeFalha("limite-do-dia") })} />);
    const motivo = screen.getByRole("alert");
    expect(motivo.textContent).toContain(fraseDeFalha("limite-do-dia"));
    expect(within(document.body).getByRole("button", { name: t.tentarDeNovo })).toBeTruthy();
  });

  it("sem Instagram ligado ou sem a publicação liberada: explica e leva à Conta, sem formulário", () => {
    for (const codigo of ["sem-conta", "sem-permissao", "acesso-perdido"] as const) {
      const { unmount } = render(<Pai visao={{ ...VISAO, situacao: { pode: false, codigo, frase: fraseDeRecusa(codigo) } }} />);
      expect(screen.getByText(fraseDeRecusa(codigo))).toBeTruthy();
      expect(screen.getByRole("link", { name: t.irParaConta }).getAttribute("href")).toBe("/conta");
      expect(document.querySelector("input[type=file]")).toBeNull();
      unmount();
    }
  });
});

describe("a espera da Meta: o ritmo é o do servidor, e dá para cancelar", () => {
  const processando = (reconferirEmSeg: number | null, extra: Partial<VistaDaPublicacao> = {}) => ({ ok: true, dado: { vista: vista({ estado: "processando", ...extra }), reconferirEmSeg } });
  const passar = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pergunta uma vez ao abrir e depois só quando o servidor manda (30 s, depois 60 s), nunca a cada 6 segundos", async () => {
    conferirPublicacaoAction.mockResolvedValueOnce(processando(30)).mockResolvedValue(processando(60));
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
    // O ritmo antigo (6 s) passaria de nove perguntas em um minuto: aqui, nenhuma antes dos 30 s.
    await passar(29_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
    await passar(1_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(2);
    await passar(59_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(2);
    await passar(1_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(3);
    // Em 6 minutos, no ritmo de 60 s: no máximo cerca de dez perguntas.
    await passar(5 * 60_000);
    expect(conferirPublicacaoAction.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("não deixa o servidor pedir pressa demais: o piso é de 5 segundos", async () => {
    conferirPublicacaoAction.mockResolvedValue(processando(1));
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    await passar(4_900);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
    await passar(200);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(2);
  });

  it("sem rede na pergunta: tenta de novo em 30 segundos, sem derrubar a folha", async () => {
    conferirPublicacaoAction.mockRejectedValueOnce(new Error("sem rede")).mockResolvedValue(processando(60));
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    expect(screen.getByText(t.processando)).toBeTruthy();
    await passar(29_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
    await passar(1_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(2);
  });

  it("o servidor ainda não terminou mas não dá número (outra conferência publicando): volta a perguntar em 10 segundos", async () => {
    conferirPublicacaoAction.mockResolvedValueOnce({ ok: true, dado: { vista: vista({ estado: "publicando" }), reconferirEmSeg: null } }).mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "publicada" }), reconferirEmSeg: null } });
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    expect(screen.getByText(t.publicando)).toBeTruthy();
    await passar(10_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t.publicadaSemLink)).toBeTruthy();
  });

  it("terminou (falhou por tempo, publicada): para de perguntar", async () => {
    conferirPublicacaoAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "falhou", motivo: fraseDeFalha("demorou") }), reconferirEmSeg: null } });
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    expect(screen.getByRole("alert").textContent).toContain(fraseDeFalha("demorou"));
    await passar(10 * 60_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
  });

  it("fechar a folha no meio da espera para as perguntas", async () => {
    conferirPublicacaoAction.mockResolvedValue(processando(30));
    const { unmount } = render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    unmount();
    await passar(5 * 60_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
  });

  it("esperando o Instagram há \"Cancelar a publicação\": avisa o servidor, volta ao formulário com o motivo e para de perguntar", async () => {
    conferirPublicacaoAction.mockResolvedValue(processando(60));
    cancelarEnvioAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "falhou", motivo: fraseDeFalha("cancelada") }) } });
    render(<Pai inicial={vista({ estado: "processando" })} />);
    await passar(0);
    fireEvent.click(screen.getByRole("button", { name: t.cancelarPublicacao }));
    await passar(0);
    expect(cancelarEnvioAction).toHaveBeenCalledWith(7);
    expect(screen.getByRole("alert").textContent).toContain(fraseDeFalha("cancelada"));
    expect(screen.getByRole("button", { name: t.tentarDeNovo })).toBeTruthy();
    await passar(5 * 60_000);
    expect(conferirPublicacaoAction).toHaveBeenCalledTimes(1);
  });

  it("publicando (o pedido já saiu): não oferece cancelar", async () => {
    conferirPublicacaoAction.mockResolvedValue({ ok: true, dado: { vista: vista({ estado: "publicando" }), reconferirEmSeg: null } });
    render(<Pai inicial={vista({ estado: "publicando" })} />);
    await passar(0);
    expect(screen.getByText(t.publicando)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.cancelarPublicacao })).toBeNull();
    expect(screen.queryByRole("button", { name: t.cancelar })).toBeNull();
  });
});

describe("com o vídeo editado do servidor (E47 PR 4)", () => {
  it("não pede o arquivo: diz que vai sair o vídeo editado e deixa publicar na hora", async () => {
    publicarEdicaoAction.mockResolvedValue({ ok: true, dado: { publicacaoId: 31 } });
    render(<Pai edicaoPronta={{ id: 9, duracaoS: 42 }} />);
    expect(document.querySelector("input[type=file]")).toBeNull();
    expect(screen.getByText(t.videoEditado)).toBeTruthy();
    const botao = screen.getByRole("button", { name: t.publicar }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(t.legenda), { target: { value: "Minha legenda" } });
    fireEvent.click(botao);
    await waitFor(() => expect(publicarEdicaoAction).toHaveBeenCalledWith(9, { tipo: "reels", legenda: "Minha legenda" }));
    await waitFor(() => expect(aoMudarObservado).toHaveBeenCalledWith({ id: 31, tipo: "reels", estado: "processando", motivo: null, permalink: null }));
    // Nada do caminho do arquivo do navegador: nem abre publicação pelo caminho antigo nem sobe bytes.
    expect(iniciarPublicacaoAction).not.toHaveBeenCalled();
    expect(EnvioFalso.ultimo).toBeNull();
  });

  it("a recusa do servidor aparece como frase na folha, e Story com vídeo editado longo demais é barrado antes", async () => {
    publicarEdicaoAction.mockResolvedValue({ ok: false, erro: fraseDeRecusa("limite") });
    render(<Pai edicaoPronta={{ id: 9, duracaoS: 42 }} />);
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    expect((await screen.findByRole("alert")).textContent).toContain(fraseDeRecusa("limite"));
    cleanup();
    publicarEdicaoAction.mockClear();
    render(<Pai visao={{ ...VISAO, tipoInicial: "story" }} edicaoPronta={{ id: 9, duracaoS: 95 }} />);
    expect((await screen.findByRole("alert")).textContent).toContain(t.duracaoLonga("story", "60 segundos"));
    fireEvent.click(screen.getByRole("button", { name: t.publicar }));
    expect(publicarEdicaoAction).not.toHaveBeenCalled();
  });
});

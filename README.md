# Impressora Enviagora

Extensão Chrome (Manifest V3) que intercepta os PDFs de etiqueta de envio — Amazon,
Shopee, Mercado Livre e Correios —, acha onde está a etiqueta de verdade, recorta,
reencaixa em **100×150 mm** e manda para a impressora térmica.

Roda em ~60 computadores da operação de fulfillment da Enviagora.

**Página de instalação:** https://enviagora.github.io/impressora-enviagora/

---

## Para quem é cada documento

| Você quer | Leia |
|---|---|
| Instalar nas máquinas | [docs/ROLLOUT.md](docs/ROLLOUT.md) |
| Decidir como distribuir | [docs/PILOTO.md](docs/PILOTO.md) — faça isto primeiro |
| Mexer no código | [docs/ARQUITETURA.md](docs/ARQUITETURA.md) |
| Entender a história dos bugs | [docs/HISTORICO-v16.33.txt](docs/HISTORICO-v16.33.txt) |

---

## Comandos

```bash
npm test              # 63 testes, incluindo as 12 etiquetas reais. Sem navegador.
npm run validate      # confere manifest, defaults.json e chave antes de publicar
npm run build         # gera ZIP, ZIP-webstore e CRX assinado em dist/
npm run bump          # sobe a versão em package.json e manifest juntos
```

Sem `npm install`: o projeto **não tem dependência** de runtime nem de build. ZIP, CRX e
testes rodam em Node puro, de propósito — é o que assina o pacote que atualiza 60 máquinas,
então a cadeia de terceiros aqui é zero.

---

## Publicar

### Uma correção de código

```bash
npm test
npm run bump -- patch          # ou minor / major
git commit -am "v16.34.1: <o que muda para a operação>"
git tag v16.34.1
git push origin main --tags
```

A tag dispara o `release.yml`: testes → confere tag × manifest → assina o CRX → cria o
Release com os três artefatos → publica o Pages. Nessa ordem, porque o `updates.xml` só
pode anunciar a versão nova depois que o CRX está baixável.

### Um ajuste de parâmetro

Edite `config/defaults.json`, suba o `configVersion`, commit na `main`. **Não publica versão
nova.** As 60 máquinas pegam em até 1 hora.

É o caminho que mais se usa: margem, texto do cabeçalho, escala, deslocamento.

### Parar tudo

`"killSwitch": true` no `config/defaults.json`, `configVersion` +1, commit. As máquinas
voltam a imprimir o PDF original em até 1 hora. Detalhes em
[ROLLOUT.md](docs/ROLLOUT.md#emergência--parar-tudo).

---

## As 12 etiquetas

`tests/fixtures/` é o ativo mais valioso deste repositório. São 12 etiquetas reais, cada
uma ali porque **já quebrou de verdade em produção** ou porque cobre uma variante distinta.

O teste roda o detector nas 12 e cobra os **dois sentidos**:

- as 5 da Amazon **têm que** devolver o retângulo esperado, com 1 pt de tolerância;
- as 7 dos Correios **têm que** devolver `null`.

Um teste que só verificasse a Amazon estaria pela metade — foi exatamente assim que os
Correios quebraram na v16.32. O CI bloqueia release se qualquer uma falhar.

---

## O que não pode regredir

Quatro correções custaram caro e estão travadas por teste. Se um teste de
`tests/invariantes.test.mjs` falhar, **não mude o teste** — leia o porquê no comentário.

1. **A detecção da Amazon é geométrica**, não por contagem de páginas.
2. **A guarda de área (70%)** impede confundir Correios com Amazon.
3. **O palpite geométrico é derrubável** pelo texto dos Correios.
4. **Os Correios saem no tamanho cheio** — a margem de segurança nunca os alcança. Margem
   lateral maior que ~1 mm e o leitor dos Correios não bipa.

---

## Estado atual

- **Versão:** 16.34.0
- **ID da extensão:** `kigacgfagjemjheogplplhcneolndhan`
- **Repositório:** precisa ser **público** — o Chrome não autentica ao procurar
  atualização, então não existe auto-update a partir de repositório privado
- **Chave privada:** fora do repositório. Cofre da empresa + secret `CRX_PRIVATE_KEY`

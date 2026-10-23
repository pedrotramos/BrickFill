# BrickFill — enriquecimento de catálogo com evidência, no Databricks

O BrickFill completa as lacunas do catálogo de um varejista com conteúdo **rastreável até a página de origem**:
- títulos, descrições, ficha técnica, FAQ e imagens;
- atributos estruturados.

É um acelerador de solução. O varejista:
1. mapeia as próprias tabelas de produtos para um contrato documentado;
2. escolhe o idioma e as regras editoriais;
3. recebe, no próprio workspace Databricks, um pipeline governado e um app de revisão.

- **Evidência ou nada.**
  - Cada valor publicado cita uma página realmente extraída, com screenshot e recorte do local onde o valor aparece.
  - Sem evidência, o valor fica vazio e vai para revisão.
- **Pesquisa web com [Firecrawl](https://firecrawl.dev).**
  - A busca encontra as páginas do fabricante e dos varejistas, e a extração lê essas páginas.
  - Ações de navegador fecham banners e abrem acordeões e abas.
  - O screenshot da página inteira e o mapa de texto permitem recortar a evidência com exatidão.
- **Regras determinísticas.** O código, e não o modelo, garante:
  - dígito do GTIN e GTIN por nível de embalagem;
  - vocabulário exato e ranking de fontes;
  - tamanhos editoriais e termos proibidos.
- **Revisão humana.**
  - Os revisores aprovam, editam (sempre com evidência própria) e publicam num Databricks App auditado.
  - Só produtos aprovados chegam à tabela de destino.
- **Global.**
  - A interface vem em inglês, português (Brasil) e espanhol.
  - O idioma do enriquecimento, o perfil editorial e o mercado são configuráveis no bundle e na tela **Settings** do app, globalmente ou por categoria. O mercado define órgãos reguladores, localização da busca e marketplaces despriorizados.

## SKUs Databricks utilizados

| SKU | Uso |
| --- | --- |
| Serverless Jobs (`JOBS`) | Contrato, preparação, enriquecimento, carga, publicação, recaptura |
| Foundation Model APIs pay-per-token (`MODEL_SERVING`) | Estruturação dos fatos e redação do conteúdo (maior custo variável) |
| Lakebase Postgres (`LAKEBASE`) | Camada de serving do app, revisões, edições, settings, auditoria |
| Tabelas sincronizadas do Lakebase (`LAKEFLOW_CONNECT` / `DLT`) | Produtos canônicos no Postgres |
| Databricks Apps (`APPS`) | App de revisão |
| Unity Catalog + Volumes | Governança, linhagem, secret do Firecrawl, arquivos de evidência |

O Firecrawl é cobrado à parte, em créditos: de 5 a 10 por produto, mediana 8.

## Desenvolvimento e contribuição

- Todas as verificações rodam localmente e no CI, sem workspace: veja [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês).
- Vulnerabilidades são reportadas de forma privada, conforme o [SECURITY.md](SECURITY.md).
- Licença: [Apache 2.0](LICENSE).

## Documentação

A documentação completa está em inglês:
- [README](README.md): visão geral e quickstart;
- [guia de setup](docs/setup-guide.md);
- [contrato de dados](docs/data-contract.md);
- [configuração](docs/configuration.md);
- [arquitetura](docs/architecture.md);
- [FinOps](docs/finops.md);
- [roadmap](docs/roadmap.md).

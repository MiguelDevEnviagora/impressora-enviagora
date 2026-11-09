/* Identificadores públicos do projeto GCP `menu-enviagora`, o mesmo da extensão Menu da Operação.
 * Nada aqui é segredo: a API key do Firebase é identificador público, restrita às APIs do login e do
 * Firestore, e o client_id do OAuth é público por definição. Quem autoriza a gravação são as regras do
 * Firestore, no servidor. Mesmo assim os dois ficam fora do git (para não parecer segredo vazado num repo
 * público): o scripts/build.mjs troca os marcadores pelas variáveis MENU_API_KEY e MENU_OAUTH_CLIENT_ID.
 * Sem elas, o menu continua abrindo (a leitura é pública); só o "Editar menu" não consegue entrar.
 */
export const PROJETO = 'menu-enviagora';
export const API_KEY = '__API_KEY__';
export const OAUTH_CLIENT_ID = '__OAUTH_CLIENT_ID__';
export const DOMINIO = 'enviagora.com.br';

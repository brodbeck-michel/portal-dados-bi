-- Marca white label: título do portal e mensagem no login (substituem o nome
-- do produto nas telas do cliente) e ícone próprio para a aba do navegador
-- (sem ele, a aba usa a logo).
ALTER TABLE tenants ADD COLUMN portal_title TEXT;
ALTER TABLE tenants ADD COLUMN login_message TEXT;
ALTER TABLE tenants ADD COLUMN favicon_mime TEXT;
ALTER TABLE tenants ADD COLUMN favicon_data BLOB;

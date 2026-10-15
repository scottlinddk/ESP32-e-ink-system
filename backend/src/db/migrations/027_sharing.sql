-- Sharing between users: connections, device collaborators and copied items.
-- Credentials and integration settings never move: a shared device keeps drawing
-- with its OWNER's integrations, and shared layouts are copied, not linked.

-- A connection is one row per pair of users; either side may have asked first.
CREATE TABLE public.user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT user_connections_distinct CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX user_connections_pair_key
  ON public.user_connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX user_connections_addressee_idx ON public.user_connections (addressee_id);

-- Collaborator access to one device. A viewer sees saved previews; an editor
-- may also change the device's layouts. Neither sees credentials or tokens.
CREATE TABLE public.device_shares (
  device_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  collaborator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, collaborator_id),
  CONSTRAINT device_shares_distinct CHECK (owner_id <> collaborator_id),
  CONSTRAINT device_shares_device_owner_fkey FOREIGN KEY (device_id, owner_id)
    REFERENCES public.devices(id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX device_shares_collaborator_idx ON public.device_shares (collaborator_id);

-- An administrative transfer must not hand the new owner's data to old collaborators.
CREATE FUNCTION public.clear_device_shares_on_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.device_shares WHERE device_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_device_shares_on_transfer() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER clear_device_shares_on_transfer
AFTER UPDATE OF user_id ON public.devices
FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.clear_device_shares_on_transfer();

-- A layout, widget or dashboard sent to a connection. The recipient receives a
-- copy when accepting it; the payload is validated again at that point.
CREATE TABLE public.shared_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('layout', 'widget', 'dashboard')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT shared_items_distinct CHECK (sender_id <> recipient_id)
);
CREATE INDEX shared_items_recipient_idx ON public.shared_items (recipient_id, status, created_at DESC);
CREATE INDEX shared_items_sender_idx ON public.shared_items (sender_id, created_at DESC);

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_connections, public.device_shares, public.shared_items FROM anon, authenticated;
GRANT ALL ON public.user_connections, public.device_shares, public.shared_items TO service_role;

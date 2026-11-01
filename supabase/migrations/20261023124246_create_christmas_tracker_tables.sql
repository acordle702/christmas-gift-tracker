/*
# Create Christmas tracker tables

1. New Tables
- `gift_people`: people on a user's Christmas list, including relationship, sizes, and planned budget.
- `gift_items`: gifts belonging to a person, including store, price, status, and hiding spot.
2. Columns
- Every row has a UUID primary key, an owner `user_id` tied to `auth.users`, and a creation timestamp.
- Gift items reference their person and are deleted automatically when that person is deleted.
3. Security
- Row level security is enabled on both tables.
- Authenticated users receive only the CRUD permissions needed by the tracker.
- Every policy checks `auth.uid()` against the row owner; users cannot read or change another user's list.
4. Important notes
- Owner IDs default from the active signed-in user so browser inserts do not need to send ownership data.
- Gift status is limited to idea, ordered, delivered, or wrapped.
- Prices and budgets are numeric values in dollars.
*/

CREATE TABLE IF NOT EXISTS public.gift_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  relationship text NOT NULL DEFAULT '',
  sizes text NOT NULL DEFAULT '',
  budget numeric(10,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gift_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.gift_people(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 200),
  store text NOT NULL DEFAULT 'Amazon',
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'ordered', 'delivered', 'wrapped')),
  hiding_spot text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_people_user_id_idx ON public.gift_people(user_id);
CREATE INDEX IF NOT EXISTS gift_items_user_id_idx ON public.gift_items(user_id);
CREATE INDEX IF NOT EXISTS gift_items_person_id_idx ON public.gift_items(person_id);

ALTER TABLE public.gift_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gift_items TO authenticated;

DROP POLICY IF EXISTS "select_own_gift_people" ON public.gift_people;
CREATE POLICY "select_own_gift_people" ON public.gift_people FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_gift_people" ON public.gift_people;
CREATE POLICY "insert_own_gift_people" ON public.gift_people FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_gift_people" ON public.gift_people;
CREATE POLICY "update_own_gift_people" ON public.gift_people FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_gift_people" ON public.gift_people;
CREATE POLICY "delete_own_gift_people" ON public.gift_people FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_gift_items" ON public.gift_items;
CREATE POLICY "select_own_gift_items" ON public.gift_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_gift_items" ON public.gift_items;
CREATE POLICY "insert_own_gift_items" ON public.gift_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.gift_people WHERE gift_people.id = person_id AND gift_people.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_gift_items" ON public.gift_items;
CREATE POLICY "update_own_gift_items" ON public.gift_items FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.gift_people WHERE gift_people.id = person_id AND gift_people.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_gift_items" ON public.gift_items;
CREATE POLICY "delete_own_gift_items" ON public.gift_items FOR DELETE TO authenticated USING (auth.uid() = user_id);
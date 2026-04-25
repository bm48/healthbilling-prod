-- When a new provider is created, automatically insert a row in provider_levels with level 1.

CREATE OR REPLACE FUNCTION public.set_default_provider_level()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.provider_levels (provider_id, level)
  VALUES (NEW.id, 1)
  ON CONFLICT (provider_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_provider_created_set_level ON public.providers;

CREATE TRIGGER on_provider_created_set_level
  AFTER INSERT ON public.providers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_default_provider_level();

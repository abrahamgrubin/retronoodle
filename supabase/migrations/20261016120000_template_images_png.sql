-- Swaps the 4 builtin templates' preview images (20261016090000) for hand-provided PNGs in
-- apps/web/public/templates/, replacing the placeholder SVG illustrations.
update public.templates set image_url = '/templates/start-stop-continue.png'
where id = '00000000-0000-4000-8000-0000000000e1';

update public.templates set image_url = '/templates/mad-sad-glad.png'
where id = '00000000-0000-4000-8000-0000000000e2';

update public.templates set image_url = '/templates/4ls.png'
where id = '00000000-0000-4000-8000-0000000000e3';

update public.templates set image_url = '/templates/sailboat.png'
where id = '00000000-0000-4000-8000-0000000000e4';

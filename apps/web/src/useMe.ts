import { useQuery } from '@tanstack/react-query';
import { fetchMe } from './auth';

/** The signed-in user's profile (GET /me), under the same query key ActionsPage already uses so
 * the drawer's account row and the home page's greeting share one cached fetch per session. */
export function useMe(accessToken: string | undefined) {
  return useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken as string),
    enabled: !!accessToken,
  });
}

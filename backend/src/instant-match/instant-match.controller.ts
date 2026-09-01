import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { JwtGuard } from '../common/guards/jwt.guard';
import {
  InstantMatchService,
  MatchStateSnapshot,
  InstantMatchChatState,
} from './instant-match.service';

/**
 * The one request the app makes about Instant Match before anything is
 * rendered.
 *
 * Everything else about Instant Match rides the socket, and deliberately so —
 * matching is a realtime feature. Initialization is the exception, and the
 * reason is a bug this endpoint exists to kill: the client's first question
 * ("am I matched right now?") used to be a socket emit, which meant it was
 * buffered until the shared socket authenticated and connected. Until that
 * answer arrived the launcher rendered its default — a plain "Instant Match"
 * button — so a user who *was* matched watched the wrong UI for as long as the
 * connection took, then saw it flip. Nobody had written a delay; the delay was
 * the connect.
 *
 * An HTTP read has none of that: it goes out with the app's other boot
 * requests, on the same already-warm auth, and answers in one round trip. The
 * socket then reconciles on top of it, exactly as it does after any reconnect.
 */
@Controller('api/instant-match')
export class InstantMatchController {
  constructor(private readonly instantMatch: InstantMatchService) {}

  /**
   * Both halves of the state in one response, because the client needs both
   * before it can decide what to draw and fetching them separately reintroduces
   * a window where one has landed and the other has not.
   */
  @Get('state')
  @UseGuards(JwtGuard)
  async getState(@Req() req: AuthenticatedRequest): Promise<{
    state: MatchStateSnapshot;
    chat: InstantMatchChatState | null;
  }> {
    const userId = req.user?.id;
    const [state, chat] = await Promise.all([
      this.instantMatch.getStateFor(userId),
      this.instantMatch.getChatStateFor(userId),
    ]);
    return { state, chat };
  }
}

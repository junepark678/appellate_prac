/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createStart } from '@tanstack/react-start'

function commaSeparatedEnv(name: string) {
  return process.env[name]?.split(',').map((value) => value.trim()).filter(Boolean)
}

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [
      clerkMiddleware({
        publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
        secretKey: process.env.CLERK_SECRET_KEY,
        signInUrl: process.env.CLERK_SIGN_IN_URL,
        signUpUrl: process.env.CLERK_SIGN_UP_URL,
        signInFallbackRedirectUrl: process.env.CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
        signUpFallbackRedirectUrl: process.env.CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
        authorizedParties: commaSeparatedEnv('CLERK_AUTHORIZED_PARTIES'),
      }),
    ],
  }
})

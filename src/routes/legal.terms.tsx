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

import { createFileRoute } from '@tanstack/react-router'

import { AppFrame } from '../components/AppFrame'

export const Route = createFileRoute('/legal/terms')({ component: Terms })

function Terms() {
  return (
    <AppFrame title="Terms of Use">
      <article className="prose max-w-none rounded border border-slate-200 bg-white p-6">
        <p>
          Access is limited to authorized institutional courses and support
          operations. The product supports appellate practice education and does
          not provide legal advice or live case assistance.
        </p>
        <p>
          Users must follow course policies, upload only permitted training
          materials, and use export features for institutional assessment only.
        </p>
      </article>
    </AppFrame>
  )
}

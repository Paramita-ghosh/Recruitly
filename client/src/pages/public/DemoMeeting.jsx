import { useParams, Link } from 'react-router-dom';
import { Mic, Video, FlaskConical } from 'lucide-react';
import Logo from '../../components/layout/Logo';

/** Placeholder room used ONLY in demo mode, so a demo "online interview" has somewhere to point. It is not a real video call. */
export default function DemoMeeting() {
  const { id } = useParams();
  return (
    <div className="grid min-h-screen place-items-center bg-navy px-6 text-white">
      <div className="max-w-lg text-center">
        <Logo light className="mb-8" />
        <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-3xl bg-white/10"><FlaskConical size={36} className="text-amber" /></div>
        <h1 className="text-3xl font-extrabold">Demo meeting room</h1>
        <p className="mt-3 text-white/70">This is a placeholder link that Recruitly generates in demo mode. No video call happens here. When Google Calendar is connected, interviews get a real Google Meet link instead.</p>
        <div className="mt-8 flex justify-center gap-3 text-white/40"><Mic /><Video /></div>
        <p className="mt-6 text-xs text-white/40">Session {id?.slice(0, 8)}</p>
        <Link to="/" className="btn-secondary mt-8">Back to Recruitly</Link>
      </div>
    </div>
  );
}

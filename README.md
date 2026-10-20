# 💪 Jaini Fitness Center — Gym Management System

Gym owner ke liye poora management app — members, plans, payments, expiry alerts, attendance, trainers, sab kuch.

## Kaise chalu karein

```bash
./start.sh     # sab kuch build karke chalu kar dega (pehli baar 3-5 min)
```

Phir browser me kholo: **http://localhost:2311**

## Pehli baar login (admin)

- Email: `admin@gym.com`
- Password: `admin123`

⚠️ **Pehla kaam:** upar **Password** button se admin ka password badal lena.

## Kya-kya chalu hai

- **Dashboard** — total members, active, 7 din me expiring, expired, is month ki income, aaj ke check-in
- **Members** — add/edit/delete, search, plan aur trainer dena, expiry set
- **Payments** — payment add karo, **"plan renew" checkbox** — payment ke saath expiry badh jayegi
- **Plans** — apne plans jaise Monthly/Quarterly/Yearly (3 pehle se bane hai)
- **Trainers** — trainer add kar do

Member apni taraf se **register** kar sakte hai, aur login karke apna plan, payments aur check-in dekhte hai.
- **Razorpay payments** — trial account se online payment aayega (jald)

## Admin commands

```bash
./stop.sh           # sab band karo (data delete nahi hoga)
./logs.sh backend   # backend ke logs
./logs.sh web       # nginx ke logs
./status.sh         # kya chal raha hai
```

## Deploy — AWS / Azure (baad me)

Code me koi IP hardcode nahi hai, sab Docker me hai. Baad me Kubernetes/Terraform me isko
cloud pe utna hoga — us waqt `frontend/nginx.conf` me backend ka hostname aur `.env` me
database ka URL badalna hoga, bas.

## Tech

Node.js (Express) + PostgreSQL + React (Vite) + Nginx + Docker Compose
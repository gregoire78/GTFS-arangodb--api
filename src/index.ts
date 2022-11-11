import * as Koa from 'koa'
import * as Router from '@koa/router'
import * as cors from '@koa/cors'
import { DateTime } from 'luxon'
import { aql, Database } from 'arangojs'

const app = new Koa()
const router = new Router()

const db = new Database({
    url: "http://localhost:8529",
    databaseName: "GTFS"
})

router.get('/', async (ctx) => {
    // distance 1km
    const cursor = await db.query(aql`
    for loc in stops
        let distance = DISTANCE(loc.lat, loc.lon, ${Number(ctx.query.lat)}, ${Number(ctx.query.lng)})
        filter loc.locationType == 0 && distance <= 1000
        sort distance
        let routes = (
            for v, e, p in 2 outbound loc._id has_routes, inbound operates
                let route = p.vertices[1]
                let agency = p.vertices[2]
                return {
                    shortName: route.shortName,
                    type: route.type,
                    color: route.color,
                    textColor: route.textColor,
                    agency: agency.name
                }
        )
        return {
            _key: loc._key,
            lon: loc.lon,
            lat: loc.lat,
            zoneId: loc.zoneId,
            name: loc.name,
            routes
        }
    `)
    const res = []
    for await (const item of cursor) {
        res.push(item)
    }
    ctx.body = res
})

router.get('/:stopId/trips', async (ctx) => {
    const now = ctx.query.date ? DateTime.fromISO(ctx.query.date.toString()) : DateTime.now()
    const dayOfWeek = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    const cursor = await db.query(aql`
    let date = ${now.toISODate()}
    let day = ${dayOfWeek[now.weekday-1]}
    for trip,e,b IN 2 inbound ${"stops/"+ctx.params.stopId} located_at, any part_of_trip
            let exec = (for o in calendar_dates filter trip.serviceId == o.serviceId return o)
            let route = document("routes", trip.routeId)
            let agency = document("agency", route.agencyId)
            for cal in calendar
                filter cal.serviceId == trip.serviceId and date_diff(cal.startDate, date, "days", false) >= 0 and
                date_diff(cal.endDate, date, "days", false) <= 0 and
                cal[day] == true and
                date != exec.date
                return unset(merge(trip, route, {service: agency.name}, {id: trip._key}), "_id", "_key", "_rev", "agencyId", "routeId", "serviceId", "shortName", "directionId")
    `)
    const res = []
    for await (const item of cursor) {
        res.push(item)
    }
    ctx.body = res
})

router.get('/:tripId/stopTimes', async (ctx) => {
    const cursor = await db.query(aql`
    for st IN 1 inbound ${"trips/"+ctx.params.tripId} part_of_trip
        sort st.stopSequence
        let stop = document('stops', st.stopId)
        return merge(st, {stopName: stop.name})
    `)
    // const res = []
    // for await (const item of cursor) {
    //     res.push(item)
    // }
    ctx.body = await cursor.all()
})

app.on('error', console.error)

app
.use(cors())
.use(router.routes())
.use(router.allowedMethods())
.listen(8080)
// Application error logging.


export default app
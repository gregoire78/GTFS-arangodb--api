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
    for v, e, p in 3 inbound ${"stops/"+ctx.params.stopId} located_at, outbound part_of_trip, inbound serves
        let trip = p.vertices[2]
        let cal = v
        let exec = (for o in calendar_dates filter trip.serviceId == o.serviceId return o)
        filter cal.serviceId == trip.serviceId and
            date_diff(cal.startDate, date, "days", false) >= 0 and
            date_diff(cal.endDate, date, "days", false) <= 0 and
            cal[day] == true and
            date != exec.date
        let op = first(for v1, e1, p1 in 2 outbound trip._id uses, inbound operates return p1)
        let v1 = flatten(push(slice(p.vertices[*], 0, -2), op.vertices))
        sort v1[3].longName, v1[2].headsign, v1[1].departureTime
        return {
            id: trip._key,
            wheelchairAccessible: trip.wheelchairAccessible,
            departureTime: v1[1].departureTime,
            arrivalTime: v1[1].arrivalTime,
            headsign: v1[2].headsign,
            color: v1[3].color,
            longName: v1[3].longName,
            textColor: v1[3].textColor,
            type: v1[3].type,
            service: v1[4].name,
        }
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